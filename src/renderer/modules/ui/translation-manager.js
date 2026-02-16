const MAX_TEXT_LENGTH = 4000;
const MAX_ITEMS_PER_REQUEST = 40;
const MAX_CHARS_PER_REQUEST = 30000;

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
    console.log('[Translation Apply] Starting apply script');
    const payload = ${payloadJson};
    const translations = Array.isArray(payload.translations)
      ? payload.translations
      : [];
    const mode = payload.displayMode === 'bilingual'
      ? 'bilingual'
      : 'replace';

    console.log('[Translation Apply] Mode:', mode, 'Translations:', translations.length);

    const nodes = window.__byteiqTranslationNodes || [];
    const textIndexes = window.__byteiqTranslationTextIndexes || [];

    console.log('[Translation Apply] Nodes:', nodes.length, 'TextIndexes:', textIndexes.length);

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

    console.log('[Translation Apply] Applied', appliedCount, 'translations');
    return { ok: true, mode, count: nodes.length, applied: appliedCount };
  })();`;
}

function createTranslationManager(options) {
  const {
    getActiveWebview,
    ipcRenderer,
    showToast,
    store
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
      aiModel: store.get('settings.translation.aiModel', '')
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

  function chunkTexts(texts) {
    const chunks = [];
    let current = [];
    let currentChars = 0;

    texts.forEach((text) => {
      const item = String(text || '').trim();
      if (!item) return;

      const nextChars = currentChars + item.length;
      const shouldSplit = current.length >= MAX_ITEMS_PER_REQUEST
        || nextChars > MAX_CHARS_PER_REQUEST;

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

  async function translateTexts(settings, texts) {
    const chunks = chunkTexts(texts);
    const allTranslations = [];

    for (const chunk of chunks) {
      console.log('[Translation] Translating chunk of', chunk.length, 'texts');

      let result;
      try {
        if (settings.engine === 'ai') {
          // AI翻译
          result = await ipcRenderer.invoke('translate-text-ai', {
            texts: chunk,
            targetLanguage: settings.targetLanguage,
            endpoint: settings.aiEndpoint,
            apiKey: settings.aiApiKey,
            requestType: settings.aiRequestType,
            model: settings.aiModel
          });
        } else {
          // Bing翻译
          result = await ipcRenderer.invoke('translate-text-batch', {
            engine: settings.engine,
            targetLanguage: settings.targetLanguage,
            texts: chunk
          });
        }
      } catch (ipcError) {
        console.error('[Translation] IPC error:', ipcError);
        throw new Error(`IPC调用失败: ${ipcError.message || ipcError}`);
      }

      console.log('[Translation] Result:', result);

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

    console.log('[Translation] translateWebview called, force:', force);

    if (!webview || webview.tagName !== 'WEBVIEW') {
      console.error('[Translation] Invalid webview:', webview);
      return { ok: false, skipped: true, reason: 'invalid-webview' };
    }

    const settings = getSettings();
    console.log('[Translation] Settings:', settings);

    if (!force && !settings.enabled) {
      console.log('[Translation] Translation disabled');
      return { ok: false, skipped: true, reason: 'disabled' };
    }
    if (settings.engine !== 'bing' && settings.engine !== 'ai') {
      console.log('[Translation] Wrong engine:', settings.engine);
      return { ok: false, skipped: true, reason: 'engine' };
    }
    // AI翻译需要检查配置
    if (settings.engine === 'ai' && (!settings.aiEndpoint || !settings.aiApiKey)) {
      console.log('[Translation] AI translation missing config');
      if (notify || force) {
        showToast('AI翻译未配置，请先设置API端点和密钥', 'error');
      }
      return { ok: false, skipped: true, reason: 'ai-config' };
    }

    const url = webview.getURL();
    console.log('[Translation] Page URL:', url);

    if (!isTranslatableUrl(url)) {
      console.log('[Translation] URL not translatable');
      return { ok: false, skipped: true, reason: 'url' };
    }

    const signature = `${url}|${settings.engine}|${settings.targetLanguage}|${settings.displayMode}`;

    const now = Date.now();
    const lastSignature = webview.dataset.translationLastRequestSignature;
    const lastAtRaw = webview.dataset.translationLastRequestAt;
    const lastAt = lastAtRaw ? Number(lastAtRaw) : 0;
    if (lastSignature === signature && lastAt && now - lastAt < 4000) {
      console.log('[Translation] Cooldown hit, skipping duplicate request');
      return { ok: true, skipped: true, reason: 'cooldown' };
    }
    webview.dataset.translationLastRequestSignature = signature;
    webview.dataset.translationLastRequestAt = String(now);
    if (!force && webview.dataset.translationSignature === signature) {
      console.log('[Translation] Same signature, skipping');
      return { ok: true, skipped: true, reason: 'same-signature' };
    }

    // 检查是否正在翻译中
    if (webview.dataset.isTranslating === 'true') {
      console.log('[Translation] Already translating, skipping');
      return { ok: false, skipped: true, reason: 'in-progress' };
    }

    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    webview.dataset.translationRequestId = requestId;
    webview.dataset.isTranslating = 'true';

    try {
      console.log('[Translation] Executing COLLECT_TEXT_SCRIPT...');
      const collected = await webview.executeJavaScript(
        COLLECT_TEXT_SCRIPT,
        true
      );
      console.log('[Translation] Collected:', collected);

      const sourceTexts = collected && Array.isArray(collected.texts)
        ? collected.texts
        : [];

      console.log('[Translation] Source texts count:', sourceTexts.length);

      if (sourceTexts.length === 0) {
        console.log('[Translation] No texts to translate');
        return { ok: true, skipped: true, reason: 'empty' };
      }

      console.log('[Translation] Calling translateTexts...');
      const translated = await translateTexts(settings, sourceTexts);
      console.log('[Translation] Translated count:', translated.length);

      if (webview.dataset.translationRequestId !== requestId) {
        return { ok: true, skipped: true, reason: 'stale' };
      }
      if (webview.getURL() !== url) {
        return { ok: true, skipped: true, reason: 'url-changed' };
      }

      console.log('[Translation] Applying translations...');
      console.log('[Translation] Translations sample:', translated.slice(0, 3));

      let applyResult;
      try {
        applyResult = await webview.executeJavaScript(
          buildApplyScript({
            translations: translated,
            displayMode: settings.displayMode
          }),
          true
        );
        console.log('[Translation] Apply result:', applyResult);
      } catch (applyError) {
        console.error('[Translation] Apply script error:', applyError);
        throw new Error(`应用翻译失败: ${applyError.message || applyError}`);
      }

      if (!applyResult || !applyResult.ok) {
        console.error('[Translation] Apply result not ok:', applyResult);
        throw new Error('翻译应用返回失败结果');
      }

      webview.dataset.translationSignature = signature;
      console.log('[Translation] Signature set:', signature);

      if (notify) {
        showToast('页面翻译完成', 'success');
      }
      console.log('[Translation] Translation completed successfully, applied:', applyResult.applied);
      webview.dataset.isTranslating = 'false';
      return { ok: true, translated: translated.length, applied: applyResult?.applied };
    } catch (error) {
      console.error('[Translation] Error:', error);
      webview.dataset.isTranslating = 'false';
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

  async function translateActiveWebview() {
    const webview = typeof getActiveWebview === 'function'
      ? getActiveWebview()
      : null;

    if (!webview) {
      showToast('无法找到当前页面的 webview', 'error');
      return { ok: false, skipped: true, reason: 'no-webview' };
    }

    console.log('[Translation] Starting translation for:', webview.getURL());
    return translateWebview(webview, { force: true, notify: true });
  }

  return {
    getSettings,
    handleWebviewDidStopLoading,
    saveSettings,
    translateActiveWebview,
    translateWebview
  };
}

module.exports = {
  createTranslationManager
};
