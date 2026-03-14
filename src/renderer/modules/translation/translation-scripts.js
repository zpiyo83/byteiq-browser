/**
 * 翻译相关脚本常量
 */

const COLLECT_TEXT_SCRIPT = `
(function() {
  const texts = [];
  const textNodes = [];
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // 排除脚本、样式、代码元素
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tagName = parent.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'code', 'pre', 'textarea', 'input', 'select'].includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        // 排除隐藏元素
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }
        // 只接受有实际内容的文本
        const text = node.textContent.trim();
        if (text.length === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (text.length > 0) {
      // 获取父元素和子节点索引
      const parent = node.parentElement;
      const parentXPath = getXPath(parent);
      // 找到文本节点在父元素childNodes中的索引
      let childIndex = -1;
      for (let i = 0; i < parent.childNodes.length; i++) {
        if (parent.childNodes[i] === node) {
          childIndex = i;
          break;
        }
      }

      if (childIndex >= 0) {
        textNodes.push({
          parentXPath: parentXPath,
          childIndex: childIndex,
          text: text
        });
        texts.push(text);
      }
    }
  }

  // 获取元素的 XPath
  function getXPath(element) {
    if (element.id) {
      return '//*[@id="' + element.id + '"]';
    }

    const paths = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 0;
      let sibling = current.previousSibling;

      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === current.tagName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      const tagName = current.tagName.toLowerCase();
      const pathIndex = (index ? '[' + (index + 1) + ']' : '');
      paths.unshift(tagName + pathIndex);

      current = current.parentElement;
    }

    return '/' + paths.join('/');
  }

  return {
    texts: texts,
    nodes: textNodes
  };
})();
`;

const APPLY_TRANSLATION_SCRIPT = `
(function(translations, nodeData) {
  // 存储 original text 用于恢复
  if (!window.__byteiqOriginalTexts) {
    window.__byteiqOriginalTexts = [];
  }

  nodeData.forEach((nodeInfo, index) => {
    try {
      // 通过父元素XPath找到父元素
      const parentResult = document.evaluate(
        nodeInfo.parentXPath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const parent = parentResult.singleNodeValue;

      if (parent && translations[index]) {
        // 通过子节点索引找到文本节点
        const textNode = parent.childNodes[nodeInfo.childIndex];
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          // 保存原文
          window.__byteiqOriginalTexts.push({
            parent: parent,
            childIndex: nodeInfo.childIndex,
            originalText: textNode.textContent
          });

          // 应用翻译
          textNode.textContent = translations[index];
        }
      }
    } catch (e) {
      console.error('Failed to apply translation:', e);
    }
  });

  return true;
})(__TRANSLATIONS__, __NODE_DATA__);
`;

const RESTORE_ORIGINAL_SCRIPT = `
(function() {
  if (!window.__byteiqOriginalTexts) {
    return false;
  }

  window.__byteiqOriginalTexts.forEach(item => {
    try {
      if (item.parent && item.parent.childNodes[item.childIndex]) {
        const textNode = item.parent.childNodes[item.childIndex];
        if (textNode.nodeType === Node.TEXT_NODE) {
          textNode.textContent = item.originalText;
        }
      }
    } catch (e) {
      console.error('Failed to restore text:', e);
    }
  });

  window.__byteiqOriginalTexts = null;
  return true;
})();
`;

const APPLY_SINGLE_TRANSLATION_SCRIPT = `
(function(translation, nodeInfo, index) {
  // 存储 original text 用于恢复
  if (!window.__byteiqOriginalTexts) {
    window.__byteiqOriginalTexts = [];
  }

  // 如果这个索引还没有保存原文，保存它
  if (!window.__byteiqOriginalTexts[index]) {
    try {
      const parentResult = document.evaluate(
        nodeInfo.parentXPath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      const parent = parentResult.singleNodeValue;

      if (parent) {
        const textNode = parent.childNodes[nodeInfo.childIndex];
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          window.__byteiqOriginalTexts[index] = {
            parent: parent,
            childIndex: nodeInfo.childIndex,
            originalText: textNode.textContent
          };
          // 应用翻译
          textNode.textContent = translation;
        }
      }
    } catch (e) {
      console.error('Failed to apply streaming translation:', e);
    }
  } else {
    // 已有原文记录，直接更新翻译
    const item = window.__byteiqOriginalTexts[index];
    if (item.parent && item.parent.childNodes[item.childIndex]) {
      const textNode = item.parent.childNodes[item.childIndex];
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        textNode.textContent = translation;
      }
    }
  }
})(__TRANSLATION__, __NODE_INFO__, __INDEX__);
`;

const SET_TRANSLATED_STATE_SCRIPT = `
(function(isTranslated) {
  window.__byteiqIsTranslated = isTranslated;
})(__IS_TRANSLATED__);
`;

const SETUP_DYNAMIC_LISTENER_SCRIPT = `
(function() {
  if (window.__byteiqDynamicObserver) {
    return; // 已经设置过了
  }

  // 检查是否需要翻译的文本（排除脚本、样式等）
  function shouldTranslate(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    const parent = node.parentElement;
    if (!parent) return false;
    const tagName = parent.tagName.toLowerCase();
    if (['script', 'style', 'noscript', 'code', 'pre', 'textarea', 'input', 'select'].includes(tagName)) {
      return false;
    }
    const style = window.getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
    const text = node.textContent.trim();
    return text.length > 0;
  }

  // 获取元素的 XPath
  function getXPath(element) {
    if (element.id) {
      return '//*[@id="' + element.id + '"]';
    }
    const paths = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 0;
      let sibling = current.previousSibling;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === current.tagName) {
          index++;
        }
        sibling = sibling.previousSibling;
      }
      const tagName = current.tagName.toLowerCase();
      const pathIndex = (index ? '[' + (index + 1) + ']' : '');
      paths.unshift(tagName + pathIndex);
      current = current.parentElement;
    }
    return '/' + paths.join('/');
  }

  // 收集未翻译的文本节点
  function collectUntranslatedTexts(nodes) {
    const texts = [];
    const nodeData = [];
    nodes.forEach(node => {
      if (!shouldTranslate(node)) return;
      const text = node.textContent.trim();
      // 检查是否已经翻译过
      if (window.__byteiqOriginalTexts) {
        const parent = node.parentElement;
        let childIndex = -1;
        for (let i = 0; i < parent.childNodes.length; i++) {
          if (parent.childNodes[i] === node) {
            childIndex = i;
            break;
          }
        }
        // 检查是否已经在原文记录中
        const alreadyTranslated = window.__byteiqOriginalTexts.some(
          item => item.parent === parent && item.childIndex === childIndex
        );
        if (alreadyTranslated) return;
      }
      const parent = node.parentElement;
      const parentXPath = getXPath(parent);
      let childIndex = -1;
      for (let i = 0; i < parent.childNodes.length; i++) {
        if (parent.childNodes[i] === node) {
          childIndex = i;
          break;
        }
      }
      if (childIndex >= 0) {
        nodeData.push({
          parentXPath: parentXPath,
          childIndex: childIndex,
          text: text
        });
        texts.push(text);
      }
    });
    return { texts, nodeData };
  }

  // 待处理的节点队列
  let pendingNodes = [];
  let debounceTimer = null;

  // 处理待翻译节点
  function processPendingNodes() {
    if (pendingNodes.length === 0) return;
    if (!window.__byteiqIsTranslated) {
      pendingNodes = [];
      return;
    }

    const { texts, nodeData } = collectUntranslatedTexts(pendingNodes);
    pendingNodes = [];

    if (texts.length > 0) {
      // 使用 ipcRenderer 发送消息到渲染进程
      if (typeof require === 'function') {
        try {
          const { ipcRenderer } = require('electron');
          ipcRenderer.sendToHost('dynamic-translation-needed', { texts, nodeData });
        } catch (e) {
          console.error('Failed to send dynamic translation request:', e);
        }
      }
    }
  }

  // 防抖延迟（毫秒）
  const DEBOUNCE_DELAY = 500;

  // MutationObserver 回调
  function onMutation(mutations) {
    if (!window.__byteiqIsTranslated) return;

    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            pendingNodes.push(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            // 收集元素内的所有文本节点
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
            let textNode;
            while (textNode = walker.nextNode()) {
              pendingNodes.push(textNode);
            }
          }
        });
      } else if (mutation.type === 'characterData') {
        // 文本内容变化
        const node = mutation.target;
        if (node.nodeType === Node.TEXT_NODE) {
          pendingNodes.push(node);
        }
      }
    });

    if (pendingNodes.length > 0) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(processPendingNodes, DEBOUNCE_DELAY);
    }
  }

  // 创建并启动观察器
  window.__byteiqDynamicObserver = new MutationObserver(onMutation);
  window.__byteiqDynamicObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  console.log('Dynamic translation listener started');
})();
`;

const TEARDOWN_DYNAMIC_LISTENER_SCRIPT = `
(function() {
  if (window.__byteiqDynamicObserver) {
    window.__byteiqDynamicObserver.disconnect();
    window.__byteiqDynamicObserver = null;
  }
  window.__byteiqIsTranslated = false;
  window.__byteiqDynamicTranslationNeeded = null;
  console.log('Dynamic translation listener stopped');
})();
`;

module.exports = {
  COLLECT_TEXT_SCRIPT,
  APPLY_TRANSLATION_SCRIPT,
  RESTORE_ORIGINAL_SCRIPT,
  APPLY_SINGLE_TRANSLATION_SCRIPT,
  SET_TRANSLATED_STATE_SCRIPT,
  SETUP_DYNAMIC_LISTENER_SCRIPT,
  TEARDOWN_DYNAMIC_LISTENER_SCRIPT
};
