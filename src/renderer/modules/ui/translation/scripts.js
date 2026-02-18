const { MAX_TEXT_LENGTH } = require('./constants');

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

module.exports = {
  COLLECT_TEXT_SCRIPT,
  buildApplyScript,
  buildRestoreScript,
  buildStreamingApplyScript
};
