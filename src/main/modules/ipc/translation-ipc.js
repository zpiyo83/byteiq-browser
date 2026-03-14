/**
 * 翻译相关 IPC 处理器
 */

function registerTranslationIpc(options) {
  const {
    ipcMain,
    store,
    translateTexts,
    translateTextsStreaming,
    chunkTexts
  } = options;

  const activeTranslationRequests = new Map(); // taskId -> ClientRequest | Set<ClientRequest>

  ipcMain.handle('translate-text', async (event, { texts, targetLanguage, taskId }) => {
    const resolvedTaskId = taskId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const translationApiEnabled = store.get('settings.translationApiEnabled', false);
      let endpoint, apiKey, requestType, model;

      if (translationApiEnabled) {
        endpoint = store.get('settings.translationEndpoint', '');
        apiKey = store.get('settings.translationApiKey', '');
        requestType = store.get('settings.translationRequestType', 'openai-chat');
        model = store.get('settings.translationModelId', 'gpt-3.5-turbo');
      } else {
        endpoint = store.get('settings.aiEndpoint', '');
        apiKey = store.get('settings.aiApiKey', '');
        requestType = store.get('settings.aiRequestType', 'openai-chat');
        model = store.get('settings.aiModelId', 'gpt-3.5-turbo');
      }

      if (!endpoint || !apiKey) {
        return {
          success: false,
          error: '请先在设置中配置翻译 API 或 AI API 端点和密钥'
        };
      }

      const maxTextsPerRequest = store.get('settings.translationMaxTexts', 500);
      const maxCharsPerRequest = store.get('settings.translationMaxChars', 50000);
      const requestTimeout = store.get('settings.translationTimeout', 120);
      const streamingEnabled = store.get('settings.translationStreaming', true);
      const concurrencyEnabled = store.get('settings.translationConcurrencyEnabled', false);
      const concurrency = Math.max(1, Math.min(10, store.get('settings.translationConcurrency', 2)));

      const results = new Array(texts.length);

      function registerRequestForTask(req) {
        const existing = activeTranslationRequests.get(resolvedTaskId);
        if (existing && typeof existing.add === 'function') {
          existing.add(req);
          return;
        }
        const set = new Set();
        set.add(req);
        activeTranslationRequests.set(resolvedTaskId, set);
      }

      function buildConcurrentGroups(allTexts, offset, limitTexts, limitChars, groupCount) {
        const remainingTexts = Math.max(0, allTexts.length - offset);
        const roundTextLimit = Math.min(limitTexts, remainingTexts);
        const actualGroups = Math.max(1, Math.min(groupCount, roundTextLimit));

        const base = Math.floor(roundTextLimit / actualGroups);
        const extra = roundTextLimit % actualGroups;
        const desiredCounts = Array.from({ length: actualGroups }, (_v, idx) => {
          return base + (idx < extra ? 1 : 0);
        });

        const groups = desiredCounts.map(() => {
          return {
            texts: [],
            startIndex: -1,
            chars: 0
          };
        });

        let globalIndex = offset;
        let takenChars = 0;

        for (let g = 0; g < groups.length; g++) {
          const group = groups[g];
          if (globalIndex >= allTexts.length) break;
          group.startIndex = globalIndex;

          while (globalIndex < allTexts.length) {
            if (group.texts.length >= desiredCounts[g]) break;
            if (group.texts.length >= maxTextsPerRequest) break;
            if (group.chars >= maxCharsPerRequest) break;
            if (takenChars >= limitChars) break;

            const nextText = allTexts[globalIndex];
            const nextLen = nextText.length;

            if (group.texts.length > 0 && group.chars + nextLen > maxCharsPerRequest) {
              break;
            }
            if (takenChars > 0 && takenChars + nextLen > limitChars) {
              break;
            }

            group.texts.push(nextText);
            group.chars += nextLen;
            takenChars += nextLen;
            globalIndex++;
          }
        }

        const nonEmptyGroups = groups.filter(group => group.texts.length > 0);
        return {
          groups: nonEmptyGroups,
          nextIndex: globalIndex
        };
      }

      if (!concurrencyEnabled || concurrency <= 1) {
        const chunks = chunkTexts(texts, {
          maxTexts: maxTextsPerRequest,
          maxChars: maxCharsPerRequest
        });

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];

          event.sender.send('translation-progress', {
            taskId: resolvedTaskId,
            current: i + 1,
            total: chunks.length,
            status: 'translating'
          });

          if (streamingEnabled) {
            const translated = await translateTextsStreaming(
              chunk.texts,
              targetLanguage,
              {
                endpoint,
                apiKey,
                requestType,
                model,
                timeout: requestTimeout * 1000,
                registerRequest: req => {
                  registerRequestForTask(req);
                }
              },
              (newTexts, allTexts, newTextsStartIndex) => {
                event.sender.send('translation-streaming', {
                  taskId: resolvedTaskId,
                  chunkIndex: i,
                  startIndex: chunk.startIndex,
                  newTexts: newTexts,
                  allTexts: allTexts,
                  newTextsStartIndex
                });
              }
            );

            translated.forEach((text, idx) => {
              results[chunk.startIndex + idx] = text;
            });
          } else {
            const translated = await translateTexts(chunk.texts, targetLanguage, {
              endpoint,
              apiKey,
              requestType,
              model,
              timeout: requestTimeout * 1000
            });

            translated.forEach((text, idx) => {
              results[chunk.startIndex + idx] = text;
            });
          }
        }
      } else {
        const perRoundMaxTexts = concurrency * maxTextsPerRequest;
        const perRoundMaxChars = concurrency * maxCharsPerRequest;
        const estimatedTotalRounds = Math.max(1, Math.ceil(texts.length / perRoundMaxTexts));

        let roundIndex = 0;
        let cursor = 0;

        while (cursor < texts.length) {
          const { groups, nextIndex } = buildConcurrentGroups(
            texts,
            cursor,
            perRoundMaxTexts,
            perRoundMaxChars,
            concurrency
          );

          if (groups.length === 0) {
            break;
          }

          roundIndex++;
          event.sender.send('translation-progress', {
            taskId: resolvedTaskId,
            current: roundIndex,
            total: estimatedTotalRounds,
            status: 'translating'
          });

          if (streamingEnabled) {
            const translatedGroups = await Promise.all(
              groups.map((group, groupIndex) => {
                return translateTextsStreaming(
                  group.texts,
                  targetLanguage,
                  {
                    endpoint,
                    apiKey,
                    requestType,
                    model,
                    timeout: requestTimeout * 1000,
                    registerRequest: req => {
                      registerRequestForTask(req);
                    }
                  },
                  (newTexts, allTexts, newTextsStartIndex) => {
                    event.sender.send('translation-streaming', {
                      taskId: resolvedTaskId,
                      chunkIndex: (roundIndex - 1) * concurrency + groupIndex,
                      startIndex: group.startIndex,
                      newTexts: newTexts,
                      allTexts: allTexts,
                      newTextsStartIndex
                    });
                  }
                );
              })
            );

            translatedGroups.forEach((translated, idx) => {
              const group = groups[idx];
              translated.forEach((text, localIndex) => {
                results[group.startIndex + localIndex] = text;
              });
            });
          } else {
            const translatedGroups = await Promise.all(
              groups.map(group => {
                return translateTexts(group.texts, targetLanguage, {
                  endpoint,
                  apiKey,
                  requestType,
                  model,
                  timeout: requestTimeout * 1000
                });
              })
            );

            translatedGroups.forEach((translated, idx) => {
              const group = groups[idx];
              translated.forEach((text, localIndex) => {
                results[group.startIndex + localIndex] = text;
              });
            });
          }

          cursor = nextIndex;
        }
      }

      event.sender.send('translation-progress', {
        taskId: resolvedTaskId,
        status: 'completed'
      });

      activeTranslationRequests.delete(resolvedTaskId);

      return {
        success: true,
        translations: results,
        taskId: resolvedTaskId
      };
    } catch (error) {
      if (error && error.message === 'Cancelled') {
        event.sender.send('translation-progress', {
          taskId: resolvedTaskId,
          status: 'cancelled'
        });
        activeTranslationRequests.delete(resolvedTaskId);
        return {
          success: false,
          cancelled: true,
          taskId: resolvedTaskId
        };
      }

      console.error('Translation error:', error);
      activeTranslationRequests.delete(resolvedTaskId);
      return {
        success: false,
        error: error.message || '翻译失败'
      };
    }
  });

  ipcMain.on('cancel-translation', (_event, { taskId }) => {
    if (!taskId) return;
    const req = activeTranslationRequests.get(taskId);
    if (!req) return;
    activeTranslationRequests.delete(taskId);
    try {
      if (req && typeof req.destroy === 'function') {
        req.destroy(new Error('Cancelled'));
        return;
      }

      if (req && typeof req.forEach === 'function') {
        req.forEach(r => {
          try {
            if (r && typeof r.destroy === 'function') {
              r.destroy(new Error('Cancelled'));
            }
          } catch (error) {
            console.error('Cancel translation failed:', error);
          }
        });
      }
    } catch (error) {
      console.error('Cancel translation failed:', error);
    }
  });

  ipcMain.handle('translate-single-text', async (event, { texts, targetLanguage }) => {
    try {
      const translationApiEnabled = store.get('settings.translationApiEnabled', false);
      let endpoint, apiKey, requestType, model;

      if (translationApiEnabled) {
        endpoint = store.get('settings.translationEndpoint', '');
        apiKey = store.get('settings.translationApiKey', '');
        requestType = store.get('settings.translationRequestType', 'openai-chat');
        model = store.get('settings.translationModelId', 'gpt-3.5-turbo');
      } else {
        endpoint = store.get('settings.aiEndpoint', '');
        apiKey = store.get('settings.aiApiKey', '');
        requestType = store.get('settings.aiRequestType', 'openai-chat');
        model = store.get('settings.aiModelId', 'gpt-3.5-turbo');
      }

      if (!endpoint || !apiKey) {
        return {
          success: false,
          error: '请先在设置中配置翻译 API 或 AI API 端点和密钥'
        };
      }

      const requestTimeout = store.get('settings.translationTimeout', 120);

      const translations = await translateTexts(texts, targetLanguage, {
        endpoint,
        apiKey,
        requestType,
        model,
        timeout: requestTimeout * 1000
      });

      return {
        success: true,
        translations: translations
      };
    } catch (error) {
      console.error('Dynamic translation error:', error);
      return {
        success: false,
        error: error.message || '翻译失败'
      };
    }
  });
}

module.exports = {
  registerTranslationIpc
};
