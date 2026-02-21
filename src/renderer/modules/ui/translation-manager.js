const {
  AI_MAX_CHARS_PER_REQUEST,
  AI_MAX_ITEMS_PER_REQUEST,
  BING_MAX_CHARS_PER_REQUEST,
  BING_MAX_ITEMS_PER_REQUEST
} = require('./translation/constants');
const {
  COLLECT_TEXT_SCRIPT,
  buildApplyScript,
  buildRestoreScript,
  buildStreamingApplyScript
} = require('./translation/scripts');
const { createDynamicTranslationController } = require('./translation/dynamic-listener');

function createTranslationManager(options) {
  const { getActiveWebview, ipcRenderer, showToast, store, onTranslationStatusChange } = options;

  function getSettings() {
    return {
      enabled: store.get('settings.translation.enabled', false),
      engine: store.get('settings.translation.engine', 'bing'),
      targetLanguage: store.get('settings.translation.targetLanguage', 'zh-Hans'),
      displayMode: store.get('settings.translation.displayMode', 'replace'),
      aiEndpoint: store.get('settings.translation.aiEndpoint', ''),
      aiApiKey: store.get('settings.translation.aiApiKey', ''),
      aiRequestType: store.get('settings.translation.aiRequestType', 'openai-chat'),
      aiModel: store.get('settings.translation.aiModel', ''),
      streaming: store.get('settings.translation.streaming', true)
    };
  }

  function saveSettings(partial) {
    if (!partial || typeof partial !== 'object') return;
    Object.entries(partial).forEach(([key, value]) => {
      store.set(`settings.translation.${key}`, value);
    });
  }

  function isTranslatableUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url);
  }

  function chunkTexts(texts, engine = 'bing') {
    // 根据翻译引擎选择不同的限制
    const maxItems = engine === 'ai' ? AI_MAX_ITEMS_PER_REQUEST : BING_MAX_ITEMS_PER_REQUEST;
    const maxChars = engine === 'ai' ? AI_MAX_CHARS_PER_REQUEST : BING_MAX_CHARS_PER_REQUEST;

    const chunks = [];
    let current = [];
    let currentChars = 0;

    texts.forEach(text => {
      const item = String(text || '').trim();
      if (!item) return;

      const nextChars = currentChars + item.length;
      const shouldSplit = current.length >= maxItems || nextChars > maxChars;

      if (shouldSplit && current.length > 0) {
        chunks.push(current);
        current = [];
        currentChars = 0;
      }

      current.push(item);
      currentChars += item.length;
    });

    if (current.length > 0) {
      chunks.push(current);
    }

    return chunks;
  }

  async function translateTexts(settings, texts, onStreamUpdate) {
    const chunks = chunkTexts(texts, settings.engine);
    const allTranslations = [];

    for (const chunk of chunks) {
      let result;
      try {
        if (settings.engine === 'ai') {
          // AI翻译
          // 设置流式更新监听器（仅在流式模式下）
          let streamHandler = null;
          const useStreaming = settings.streaming !== false;

          if (useStreaming && typeof onStreamUpdate === 'function') {
            streamHandler = (_event, data) => {
              onStreamUpdate(data);
            };
            ipcRenderer.on('translation-stream-update', streamHandler);
          }

          try {
            result = await ipcRenderer.invoke('translate-text-ai', {
              texts: chunk,
              targetLanguage: settings.targetLanguage,
              endpoint: settings.aiEndpoint,
              apiKey: settings.aiApiKey,
              requestType: settings.aiRequestType,
              model: settings.aiModel,
              streaming: useStreaming
            });
          } finally {
            // 移除流式更新监听器
            if (streamHandler) {
              ipcRenderer.removeListener('translation-stream-update', streamHandler);
            }
          }
        } else {
          // Bing翻译
          result = await ipcRenderer.invoke('translate-text-batch', {
            engine: settings.engine,
            targetLanguage: settings.targetLanguage,
            texts: chunk
          });
        }
      } catch (ipcError) {
        console.error('[翻译] IPC错误:', ipcError.message || ipcError);
        throw new Error(`IPC调用失败: ${ipcError.message || ipcError}`);
      }

      if (!result || !result.ok) {
        const message = result && result.message ? result.message : 'Translation request failed';
        throw new Error(message);
      }

      const translated = Array.isArray(result.translations) ? result.translations : [];

      if (translated.length !== chunk.length) {
        throw new Error('Translation result count mismatch');
      }

      allTranslations.push(...translated);
    }

    return allTranslations;
  }

  async function translateWebview(webview, options = {}) {
    const { force = false, notify = false } = options;

    if (!webview || webview.tagName !== 'WEBVIEW') {
      return { ok: false, skipped: true, reason: 'invalid-webview' };
    }

    const settings = getSettings();

    if (!force && !settings.enabled) {
      return { ok: false, skipped: true, reason: 'disabled' };
    }
    if (settings.engine !== 'bing' && settings.engine !== 'ai') {
      return { ok: false, skipped: true, reason: 'engine' };
    }
    // AI翻译需要检查配置
    if (settings.engine === 'ai' && (!settings.aiEndpoint || !settings.aiApiKey)) {
      if (notify || force) {
        showToast('AI翻译未配置，请先设置API端点和密钥', 'error');
      }
      return { ok: false, skipped: true, reason: 'ai-config' };
    }

    const url = webview.getURL();

    if (!isTranslatableUrl(url)) {
      return { ok: false, skipped: true, reason: 'url' };
    }

    const signature = `${url}|${settings.engine}|${settings.targetLanguage}|${settings.displayMode}`;

    const now = Date.now();
    const lastSignature = webview.dataset.translationLastRequestSignature;
    const lastAtRaw = webview.dataset.translationLastRequestAt;
    const lastAt = lastAtRaw ? Number(lastAtRaw) : 0;
    if (lastSignature === signature && lastAt && now - lastAt < 4000) {
      return { ok: true, skipped: true, reason: 'cooldown' };
    }
    webview.dataset.translationLastRequestSignature = signature;
    webview.dataset.translationLastRequestAt = String(now);
    if (!force && webview.dataset.translationSignature === signature) {
      return { ok: true, skipped: true, reason: 'same-signature' };
    }

    // 检查是否正在翻译中
    if (webview.dataset.isTranslating === 'true') {
      return { ok: false, skipped: true, reason: 'in-progress' };
    }

    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    webview.dataset.translationRequestId = requestId;
    webview.dataset.isTranslating = 'true';

    // 通知翻译开始
    if (typeof onTranslationStatusChange === 'function') {
      onTranslationStatusChange(true);
    }

    try {
      const collected = await webview.executeJavaScript(COLLECT_TEXT_SCRIPT, true);

      const sourceTexts = collected && Array.isArray(collected.texts) ? collected.texts : [];

      if (sourceTexts.length === 0) {
        // 通知翻译结束（没有内容需要翻译）
        if (typeof onTranslationStatusChange === 'function') {
          onTranslationStatusChange(false);
        }
        return { ok: true, skipped: true, reason: 'empty' };
      }

      // 流式更新回调函数
      let lastAppliedIndex = 0;
      const onStreamUpdate = async data => {
        if (!data || !Array.isArray(data.translations)) return;

        // 检查请求是否仍然有效
        if (webview.dataset.translationRequestId !== requestId) return;
        if (webview.getURL() !== url) return;

        const translations = data.translations;
        const startIndex = data.startIndex || lastAppliedIndex;

        if (translations.length <= lastAppliedIndex) return;

        try {
          // 流式应用翻译
          await webview.executeJavaScript(
            buildStreamingApplyScript({
              translations: translations,
              displayMode: settings.displayMode,
              startIndex: startIndex
            }),
            true
          );
          lastAppliedIndex = translations.length;
        } catch (err) {
          console.error('[翻译] 流式应用错误:', err.message);
        }
      };

      const translated = await translateTexts(settings, sourceTexts, onStreamUpdate);

      if (webview.dataset.translationRequestId !== requestId) {
        return { ok: true, skipped: true, reason: 'stale' };
      }
      if (webview.getURL() !== url) {
        return { ok: true, skipped: true, reason: 'url-changed' };
      }

      // 对于AI翻译，流式更新已经应用了大部分翻译
      // 但仍需确保所有翻译都已应用（处理最后一批）
      let applyResult;
      try {
        // 如果是AI翻译且已通过流式应用了部分，只应用剩余部分
        // 否则应用全部翻译
        if (settings.engine === 'ai' && lastAppliedIndex > 0) {
          // 流式翻译已应用部分，确保剩余部分应用
          if (lastAppliedIndex < translated.length) {
            applyResult = await webview.executeJavaScript(
              buildStreamingApplyScript({
                translations: translated,
                displayMode: settings.displayMode,
                startIndex: lastAppliedIndex
              }),
              true
            );
          } else {
            applyResult = { ok: true, applied: lastAppliedIndex };
          }
        } else {
          // 非流式翻译，一次性应用全部
          applyResult = await webview.executeJavaScript(
            buildApplyScript({
              translations: translated,
              displayMode: settings.displayMode
            }),
            true
          );
        }
      } catch (applyError) {
        console.error('[翻译] 应用错误:', applyError.message);
        throw new Error(`应用翻译失败: ${applyError.message || applyError}`);
      }

      if (!applyResult || !applyResult.ok) {
        throw new Error('翻译应用返回失败结果');
      }

      webview.dataset.translationSignature = signature;

      if (notify) {
        showToast('页面翻译完成', 'success');
      }
      webview.dataset.isTranslating = 'false';

      // 注入动态翻译监听器
      injectDynamicTranslationListener(webview);

      // 通知翻译结束
      if (typeof onTranslationStatusChange === 'function') {
        onTranslationStatusChange(false);
      }

      return { ok: true, translated: translated.length, applied: applyResult?.applied };
    } catch (error) {
      webview.dataset.isTranslating = 'false';

      // 通知翻译结束
      if (typeof onTranslationStatusChange === 'function') {
        onTranslationStatusChange(false);
      }

      const message = error && error.message ? error.message : String(error);
      if (notify || force) {
        showToast(`翻译失败: ${message}`, 'error');
      }
      return { ok: false, message };
    }
  }

  async function handleWebviewDidStopLoading(webview) {
    await translateWebview(webview, { force: false, notify: false });
  }

  async function restoreOriginalText(webview) {
    if (!webview || webview.tagName !== 'WEBVIEW') {
      return { ok: false, skipped: true, reason: 'invalid-webview' };
    }

    // 停止动态翻译监听
    stopDynamicTranslationListener(webview);

    try {
      const result = await webview.executeJavaScript(buildRestoreScript(), true);

      // 清理翻译签名
      delete webview.dataset.translationSignature;
      delete webview.dataset.translationLastRequestSignature;
      delete webview.dataset.translationLastRequestAt;

      return { ok: true, restored: result?.count || 0 };
    } catch (error) {
      console.error('[翻译] 恢复原文失败:', error.message);
      return { ok: false, message: error.message };
    }
  }

  async function translateActiveWebview() {
    const webview = typeof getActiveWebview === 'function' ? getActiveWebview() : null;

    if (!webview) {
      showToast('无法找到当前页面的 webview', 'error');
      return { ok: false, skipped: true, reason: 'no-webview' };
    }

    return translateWebview(webview, { force: true, notify: true });
  }

  async function diagnoseNetwork() {
    const settings = getSettings();

    if (settings.engine !== 'ai') {
      showToast('网络诊断仅支持AI翻译引擎', 'warning');
      return { ok: false, message: '仅支持AI翻译引擎' };
    }

    if (!settings.aiEndpoint) {
      showToast('请先配置AI翻译端点', 'error');
      return { ok: false, message: '缺少AI端点配置' };
    }

    try {
      showToast('正在诊断网络连接...', 'info');
      const result = await ipcRenderer.invoke('diagnose-translation-network', {
        endpoint: settings.aiEndpoint
      });

      if (!result || !result.ok) {
        const message = result?.message || '诊断失败';
        showToast(`诊断失败: ${message}`, 'error');
        return result;
      }

      const diagnostics = result.diagnostics;
      console.error('[网络诊断] 结果:', diagnostics);

      // 显示诊断结果
      if (diagnostics.suggestions && diagnostics.suggestions.length > 0) {
        const firstSuggestion = diagnostics.suggestions[0];
        showToast(`${firstSuggestion.issue}: ${firstSuggestion.suggestion}`, 'info', 8000);
      }

      return result;
    } catch (error) {
      console.error('[网络诊断] 错误:', error);
      showToast(`诊断错误: ${error.message}`, 'error');
      return { ok: false, message: error.message };
    }
  }

  const dynamicTranslationController = createDynamicTranslationController({
    getSettings,
    ipcRenderer
  });
  const { injectDynamicTranslationListener, stopDynamicTranslationListener } =
    dynamicTranslationController;

  return {
    getSettings,
    handleWebviewDidStopLoading,
    restoreOriginalText,
    saveSettings,
    injectDynamicTranslationListener,
    stopDynamicTranslationListener,
    translateActiveWebview,
    translateWebview,
    diagnoseNetwork
  };
}

module.exports = {
  createTranslationManager
};
