// 单个文本块的最大长度
const MAX_TEXT_LENGTH = 4000;

// Bing翻译的限制（较严格）
const BING_MAX_ITEMS_PER_REQUEST = 40;
const BING_MAX_CHARS_PER_REQUEST = 30000;

// AI翻译的限制（较宽松，大多数AI模型支持较大的context）
const AI_MAX_ITEMS_PER_REQUEST = 500;
const AI_MAX_CHARS_PER_REQUEST = 200000;

// 动态翻译防抖延迟（毫秒）
const DYNAMIC_TRANSLATION_DEBOUNCE_DELAY = 500;

const COLLECT_TEXT_SCRIPT = `(() => {
  const root = document.body || document.documentElement;
  if (!root) {
    return { texts: [], nodeCount: 0, textCount: 0 };
  }

  document
    .querySelectorAll('[data-byteiq-translation-wrapper="1"]')
    .forEach((wrapper) => {
      const sourceText = wrapper.getAttribute('data-byteiq-source') || '';
      wrapper.replaceWith(document.createTextNode(sourceText));
    });

  const excludedTags = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEXTAREA',
    'INPUT',
    'SELECT',
    'OPTION'
  ]);

  const nodes = [];
  const textIndexes = [];
  const texts = [];
  const textMap = new Map();

  const collectFromRoot = (rootNode) => {
    if (!rootNode) return;

    const walker = document.createTreeWalker(
      rootNode,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node || !node.parentElement) {
            return NodeFilter.FILTER_REJECT;
          }

          const parent = node.parentElement;
          if (excludedTags.has(parent.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest('[contenteditable="true"]')) {
            return NodeFilter.FILTER_REJECT;
          }

          const originalText = typeof node.__byteiqOriginalText === 'string'
            ? node.__byteiqOriginalText
            : node.nodeValue;
          if (!originalText) {
            return NodeFilter.FILTER_REJECT;
          }

          const normalized = originalText.replace(/\\s+/g, ' ').trim();
          if (!normalized || normalized.length > ${MAX_TEXT_LENGTH}) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const originalText = typeof node.__byteiqOriginalText === 'string'
        ? node.__byteiqOriginalText
        : node.nodeValue;
      const normalized = originalText.replace(/\\s+/g, ' ').trim();

      let textIndex = textMap.get(normalized);
      if (typeof textIndex !== 'number') {
        textIndex = texts.length;
        texts.push(normalized);
        textMap.set(normalized, textIndex);
      }

      nodes.push(node);
      textIndexes.push(textIndex);
    }
  };

  const collectShadowRoots = (rootElement) => {
    if (!rootElement || !rootElement.querySelectorAll) return;

    const elements = rootElement.querySelectorAll('*');
    elements.forEach((el) => {
      if (el && el.shadowRoot) {
        collectFromRoot(el.shadowRoot);
        collectShadowRoots(el.shadowRoot);
      }
    });
  };

  collectFromRoot(root);
  collectShadowRoots(root);

  // 同源 iframe：跨域 iframe 会因浏览器安全限制无法访问，直接跳过
  document.querySelectorAll('iframe').forEach((iframe) => {
    try {
      const doc = iframe && iframe.contentDocument;
      const iframeRoot = doc && (doc.body || doc.documentElement);
      if (iframeRoot) {
        collectFromRoot(iframeRoot);
        collectShadowRoots(iframeRoot);
      }
    } catch (e) {
      // ignore
    }
  });

  window.__byteiqTranslationNodes = nodes;
  window.__byteiqTranslationTextIndexes = textIndexes;

  return {
    texts,
    nodeCount: nodes.length,
    textCount: texts.length
  };
})();`;

function buildApplyScript(payload) {
  const payloadJson = JSON.stringify(payload);

  return `(() => {
    const payload = ${payloadJson};
    const translations = Array.isArray(payload.translations)
      ? payload.translations
      : [];
    const mode = payload.displayMode === 'bilingual'
      ? 'bilingual'
      : 'replace';

    const nodes = window.__byteiqTranslationNodes || [];
    const textIndexes = window.__byteiqTranslationTextIndexes || [];

    const wrapperByIndex = new Map();
    if (mode === 'bilingual') {
      document
        .querySelectorAll('[data-byteiq-translation-wrapper="1"][data-byteiq-translation-index]')
        .forEach((wrapper) => {
          const idx = Number(wrapper.getAttribute('data-byteiq-translation-index'));
          if (!Number.isNaN(idx)) {
            wrapperByIndex.set(idx, wrapper);
          }
        });
    }

    const ensureStyle = () => {
      if (document.getElementById('__byteiq-translation-style')) {
        return;
      }

      const style = document.createElement('style');
      style.id = '__byteiq-translation-style';
      style.textContent = [
        '[data-byteiq-translation-wrapper="1"]{',
        'display:inline-block;',
        'vertical-align:baseline;',
        'line-height:1.4;',
        '}',
        '[data-byteiq-source-line="1"]{',
        'display:block;',
        'opacity:.82;',
        '}',
        '[data-byteiq-target-line="1"]{',
        'display:block;',
        'font-weight:600;',
        'margin-top:2px;',
        '}'
      ].join('');
      (document.head || document.documentElement).appendChild(style);
    };

    if (mode === 'bilingual') {
      ensureStyle();
    }

    let appliedCount = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const index = textIndexes[i];
      if (!node || typeof index !== 'number') {
        continue;
      }

      const translatedText = translations[index];
      if (!translatedText) {
        continue;
      }

      const sourceText = typeof node.__byteiqOriginalText === 'string'
        ? node.__byteiqOriginalText
        : (node.nodeValue || '');

      if (mode === 'replace') {
        if (typeof node.__byteiqOriginalText !== 'string') {
          node.__byteiqOriginalText = sourceText;
        }
        node.nodeValue = translatedText;
        appliedCount++;
        continue;
      }

      const wrapper = document.createElement('span');
      wrapper.setAttribute('data-byteiq-translation-wrapper', '1');
      wrapper.setAttribute('data-byteiq-source', sourceText);

      const sourceLine = document.createElement('span');
      sourceLine.setAttribute('data-byteiq-source-line', '1');
      sourceLine.textContent = sourceText;

      const targetLine = document.createElement('span');
      targetLine.setAttribute('data-byteiq-target-line', '1');
      targetLine.textContent = translatedText;

      wrapper.appendChild(sourceLine);
      wrapper.appendChild(targetLine);
      node.replaceWith(wrapper);
      appliedCount++;
    }

    return { ok: true, mode, count: nodes.length, applied: appliedCount };
  })();`;
}

// 流式应用翻译脚本 - 用于增量更新
function buildStreamingApplyScript(payload) {
  const payloadJson = JSON.stringify(payload);

  return `(() => {
    const payload = ${payloadJson};
    const translations = Array.isArray(payload.translations)
      ? payload.translations
      : [];
    const mode = payload.displayMode === 'bilingual'
      ? 'bilingual'
      : 'replace';
    const startIndex = payload.startIndex || 0;

    const nodes = window.__byteiqTranslationNodes || [];
    const textIndexes = window.__byteiqTranslationTextIndexes || [];

    const ensureStyle = () => {
      if (document.getElementById('__byteiq-translation-style')) {
        return;
      }

      const style = document.createElement('style');
      style.id = '__byteiq-translation-style';
      style.textContent = [
        '[data-byteiq-translation-wrapper="1"]{',
        'display:inline-block;',
        'vertical-align:baseline;',
        'line-height:1.4;',
        '}',
        '[data-byteiq-source-line="1"]{',
        'display:block;',
        'opacity:.82;',
        '}',
        '[data-byteiq-target-line="1"]{',
        'display:block;',
        'font-weight:600;',
        'margin-top:2px;',
        '}',
        '[data-byteiq-translating="1"]{',
        'background:linear-gradient(90deg,transparent 50%,rgba(66,133,244,0.15) 50%);',
        'background-size:200% 100%;',
        'animation:byteiq-translating 1.5s linear infinite;',
        '}',
        '@keyframes byteiq-translating{',
        '0%{background-position:200% 0}',
        '100%{background-position:0 0}',
        '}'
      ].join('');
      (document.head || document.documentElement).appendChild(style);
    };

    ensureStyle();

    let appliedCount = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const index = textIndexes[i];
      if (!node || typeof index !== 'number') {
        continue;
      }

      // 只处理新的翻译
      if (index < startIndex) {
        continue;
      }

      const translatedText = translations[index];
      if (!translatedText) {
        continue;
      }

      const sourceText = typeof node.__byteiqOriginalText === 'string'
        ? node.__byteiqOriginalText
        : (node.nodeValue || '');

      if (mode === 'replace') {
        if (typeof node.__byteiqOriginalText !== 'string') {
          node.__byteiqOriginalText = sourceText;
        }
        node.nodeValue = translatedText;
        appliedCount++;
        continue;
      }

      // 双语模式
      const existingWrapper = wrapperByIndex.get(index);
      if (existingWrapper) {
        const targetLine = existingWrapper.querySelector(
          '[data-byteiq-target-line="1"]'
        );
        if (targetLine) {
          targetLine.textContent = translatedText;
          appliedCount++;
        }
        continue;
      }

      const wrapper = document.createElement('span');
      wrapper.setAttribute('data-byteiq-translation-wrapper', '1');
      wrapper.setAttribute('data-byteiq-source', sourceText);
      wrapper.setAttribute('data-byteiq-translation-index', String(index));

      const sourceLine = document.createElement('span');
      sourceLine.setAttribute('data-byteiq-source-line', '1');
      sourceLine.textContent = sourceText;

      const targetLine = document.createElement('span');
      targetLine.setAttribute('data-byteiq-target-line', '1');
      targetLine.textContent = translatedText;

      wrapper.appendChild(sourceLine);
      wrapper.appendChild(targetLine);
      node.replaceWith(wrapper);
      wrapperByIndex.set(index, wrapper);
      appliedCount++;
    }

    return { ok: true, applied: appliedCount };
  })();`;
}

// 恢复原文脚本
function buildRestoreScript() {
  return `(() => {
    const nodes = window.__byteiqTranslationNodes || [];
    const textIndexes = window.__byteiqTranslationTextIndexes || [];

    let restoredCount = 0;

    // 恢复被替换的文本节点
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node) continue;

      const sourceText = typeof node.__byteiqOriginalText === 'string'
        ? node.__byteiqOriginalText
        : null;

      if (sourceText !== null) {
        node.nodeValue = sourceText;
        restoredCount++;
      }
    }

    // 恢复双语模式的 wrapper
    document
      .querySelectorAll('[data-byteiq-translation-wrapper="1"]')
      .forEach((wrapper) => {
        const sourceText = wrapper.getAttribute('data-byteiq-source') || '';
        if (sourceText) {
          wrapper.replaceWith(document.createTextNode(sourceText));
          restoredCount++;
        }
      });

    // 清理全局变量
    window.__byteiqTranslationNodes = null;
    window.__byteiqTranslationTextIndexes = null;

    // 清理翻译样式
    const style = document.getElementById('__byteiq-translation-style');
    if (style) {
      style.remove();
    }

    return { ok: true, count: restoredCount };
  })();`;
}

function createTranslationManager(options) {
  const {
    getActiveWebview,
    ipcRenderer,
    showToast,
    store,
    onTranslationStatusChange
  } = options;

  function getSettings() {
    return {
      enabled: store.get('settings.translation.enabled', false),
      engine: store.get('settings.translation.engine', 'bing'),
      targetLanguage: store.get(
        'settings.translation.targetLanguage',
        'zh-Hans'
      ),
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

    texts.forEach((text) => {
      const item = String(text || '').trim();
      if (!item) return;

      const nextChars = currentChars + item.length;
      const shouldSplit = current.length >= maxItems
        || nextChars > maxChars;

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
        const message = result && result.message
          ? result.message
          : 'Translation request failed';
        throw new Error(message);
      }

      const translated = Array.isArray(result.translations)
        ? result.translations
        : [];

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
      const collected = await webview.executeJavaScript(
        COLLECT_TEXT_SCRIPT,
        true
      );

      const sourceTexts = collected && Array.isArray(collected.texts)
        ? collected.texts
        : [];

      if (sourceTexts.length === 0) {
        // 通知翻译结束（没有内容需要翻译）
        if (typeof onTranslationStatusChange === 'function') {
          onTranslationStatusChange(false);
        }
        return { ok: true, skipped: true, reason: 'empty' };
      }

      // 流式更新回调函数
      let lastAppliedIndex = 0;
      const onStreamUpdate = async (data) => {
        if (!data || !Array.isArray(data.translations)) return;

        // 检查请求是否仍然有效
        if (webview.dataset.translationRequestId !== requestId) return;
        if (webview.getURL() !== url) return;

        const translations = data.translations;
        const startIndex = data.startIndex || lastAppliedIndex;

        if (translations.length <= lastAppliedIndex) return;

        console.log('[Translation Stream] Applying incremental update, startIndex:', startIndex, 'total:', translations.length);

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
    const webview = typeof getActiveWebview === 'function'
      ? getActiveWebview()
      : null;

    if (!webview) {
      showToast('无法找到当前页面的 webview', 'error');
      return { ok: false, skipped: true, reason: 'no-webview' };
    }

    return translateWebview(webview, { force: true, notify: true });
  }

  // 注入动态翻译监听器到页面中
  function injectDynamicTranslationListener(webview) {
    if (!webview || webview.tagName !== 'WEBVIEW') return;

    // 清除之前的监听器（如果有）
    if (webview.__dynamicTranslationInterval) {
      clearInterval(webview.__dynamicTranslationInterval);
      webview.__dynamicTranslationInterval = null;
    }

    const settings = getSettings();
    const targetLanguage = settings.targetLanguage;
    const engine = settings.engine;
    const displayMode = settings.displayMode;
    const aiEndpoint = settings.aiEndpoint;
    const aiApiKey = settings.aiApiKey;
    const aiRequestType = settings.aiRequestType;
    const aiModel = settings.aiModel;

    // 定期轮询检查新内容
    webview.__dynamicTranslationInterval = setInterval(async () => {
      try {
        // 收集新的文本节点
        const collected = await webview.executeJavaScript(`(() => {
          const excludedTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);
          const nodes = [];

          const walker = document.createTreeWalker(
            document.body || document.documentElement,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode(node) {
                if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (excludedTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
                if (parent.closest('[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
                if (parent.closest('[data-byteiq-translation-wrapper="1"]')) return NodeFilter.FILTER_REJECT;
                if (typeof node.__byteiqOriginalText === 'string') return NodeFilter.FILTER_REJECT;
                const text = node.nodeValue.replace(/\\s+/g, ' ').trim();
                if (!text || text.length > 4000) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
              }
            }
          );

          while (walker.nextNode()) {
            const node = walker.currentNode;
            const text = node.nodeValue.replace(/\\s+/g, ' ').trim();
            nodes.push({
              text: text,
              index: nodes.length
            });
          }

          return nodes.slice(0, 100); // 最多处理 100 个节点
        })()`, true);

        if (!collected || collected.length === 0) return;

        // 翻译新文本
        let result;
        if (engine === 'ai') {
          result = await ipcRenderer.invoke('translate-text-ai', {
            texts: collected.map(n => n.text),
            targetLanguage: targetLanguage,
            endpoint: aiEndpoint,
            apiKey: aiApiKey,
            requestType: aiRequestType,
            model: aiModel,
            streaming: false
          });
        } else {
          result = await ipcRenderer.invoke('translate-text-batch', {
            engine: engine,
            targetLanguage: targetLanguage,
            texts: collected.map(n => n.text)
          });
        }

        if (result && result.ok && Array.isArray(result.translations)) {
          const translations = result.translations;

          // 应用翻译结果
          await webview.executeJavaScript(`(() => {
            const translations = ${JSON.stringify(translations)};
            const nodesInfo = ${JSON.stringify(collected)};
            const displayMode = '${displayMode}';

            const ensureStyle = () => {
              if (document.getElementById('__byteiq-translation-style')) return;
              const style = document.createElement('style');
              style.id = '__byteiq-translation-style';
              style.textContent = [
                '[data-byteiq-translation-wrapper="1"]{display:inline-block;vertical-align:baseline;line-height:1.4;}',
                '[data-byteiq-source-line="1"]{display:block;opacity:.82;}',
                '[data-byteiq-target-line="1"]{display:block;font-weight:600;margin-top:2px;}'
              ].join('');
              (document.head || document.documentElement).appendChild(style);
            };

            if (displayMode === 'bilingual') ensureStyle();

            for (let i = 0; i < translations.length; i++) {
              const nodeInfo = nodesInfo[i];
              if (!nodeInfo) continue;

              // 查找对应的节点（通过文本内容匹配）
              const allTextNodes = Array.from(document.evaluate(
                '//text()[normalize-space()]',
                document.body,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null
              )).map(n => n);

              const targetNode = allTextNodes.find(n => {
                const text = n.nodeValue.replace(/\\s+/g, ' ').trim();
                return text === nodeInfo.text;
              });

              if (!targetNode) continue;

              const sourceText = nodeInfo.text;
              const translatedText = translations[i];

              if (displayMode === 'replace') {
                if (typeof targetNode.__byteiqOriginalText !== 'string') {
                  targetNode.__byteiqOriginalText = sourceText;
                }
                targetNode.nodeValue = translatedText;
              } else {
                const wrapper = document.createElement('span');
                wrapper.setAttribute('data-byteiq-translation-wrapper', '1');
                wrapper.setAttribute('data-byteiq-source', sourceText);

                const sourceLine = document.createElement('span');
                sourceLine.setAttribute('data-byteiq-source-line', '1');
                sourceLine.textContent = sourceText;

                const targetLine = document.createElement('span');
                targetLine.setAttribute('data-byteiq-target-line', '1');
                targetLine.textContent = translatedText;

                wrapper.appendChild(sourceLine);
                wrapper.appendChild(targetLine);
                targetNode.replaceWith(wrapper);
              }
            }
          })()`, true);
        }
      } catch (error) {
        // 忽略错误，下次轮询会重试
      }
    }, 2000); // 每 2 秒检查一次
  }

  // 停止动态翻译
  function stopDynamicTranslationListener(webview) {
    if (!webview) return;
    if (webview.__dynamicTranslationInterval) {
      clearInterval(webview.__dynamicTranslationInterval);
      webview.__dynamicTranslationInterval = null;
    }
  }

  return {
    getSettings,
    handleWebviewDidStopLoading,
    restoreOriginalText,
    saveSettings,
    injectDynamicTranslationListener,
    stopDynamicTranslationListener,
    translateActiveWebview,
    translateWebview
  };
}

module.exports = {
  createTranslationManager
};
