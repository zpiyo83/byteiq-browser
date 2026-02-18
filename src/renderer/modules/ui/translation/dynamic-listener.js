function createDynamicTranslationController(options) {
  const { getSettings, ipcRenderer } = options;

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
    injectDynamicTranslationListener,
    stopDynamicTranslationListener
  };
}

module.exports = {
  createDynamicTranslationController
};
