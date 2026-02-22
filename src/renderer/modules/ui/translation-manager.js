/**
 * 翻译管理器
 * 负责页面翻译、状态管理、UI 交互
 */

// 文本收集脚本 - 收集页面中可翻译的文本节点
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

// 应用翻译脚本 - 将翻译结果应用到页面
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

// 恢复原文脚本
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

// 流式应用单个翻译结果脚本
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

function createTranslationManager(options) {
  const { documentRef, store, t, showToast, ipcRenderer, getActiveTabId } = options;

  // 翻译状态
  const translationState = new Map(); // tabId -> { isTranslated, isTranslating, nodeData }

  // 当前翻译任务信息（用于流式更新）
  let currentTranslationNodes = null;
  let streamingTranslationActive = false;
  let currentTranslationTaskId = null;

  /**
   * 获取当前活跃的 webview
   */
  function getActiveWebview() {
    const tabId = getActiveTabId();
    return documentRef.getElementById(`webview-${tabId}`);
  }

  /**
   * 获取翻译按钮
   */
  function getTranslateBtn() {
    return documentRef.getElementById('translate-btn');
  }

  /**
   * 更新翻译按钮状态
   */
  function updateTranslateBtnState(tabId, state) {
    const btn = getTranslateBtn();
    if (!btn) return;

    const tabState = translationState.get(tabId);

    btn.classList.remove('translating', 'translated');

    if (state === 'translating' || tabState?.isTranslating) {
      btn.classList.add('translating');
      btn.setAttribute('data-i18n-title', 'translation.translating');
    } else if (state === 'translated' || tabState?.isTranslated) {
      btn.classList.add('translated');
      btn.setAttribute('data-i18n-title', 'translation.restore');
    } else {
      btn.setAttribute('data-i18n-title', 'translation.translate');
    }
  }

  /**
   * 应用流式翻译结果
   */
  async function applyStreamingTranslation(webview, newTexts, startIndex) {
    if (!currentTranslationNodes || !newTexts || newTexts.length === 0) return;

    for (let i = 0; i < newTexts.length; i++) {
      const globalIndex = startIndex + i;
      const nodeInfo = currentTranslationNodes[globalIndex];
      const translation = newTexts[i];

      if (nodeInfo && translation) {
        const script = APPLY_SINGLE_TRANSLATION_SCRIPT.replace(
          '__TRANSLATION__',
          JSON.stringify(translation)
        )
          .replace('__NODE_INFO__', JSON.stringify(nodeInfo))
          .replace('__INDEX__', globalIndex.toString());

        try {
          await webview.executeJavaScript(script);
        } catch (e) {
          console.error('Failed to apply streaming translation:', e);
        }
      }
    }
  }

  /**
   * 执行翻译
   */
  async function handleTranslate() {
    const webview = getActiveWebview();
    if (!webview || webview.tagName !== 'WEBVIEW') {
      showToast(t('translation.noPage') || '请先打开一个网页', 'warning');
      return;
    }

    const tabId = getActiveTabId();
    const tabState = translationState.get(tabId);

    // 如果已翻译，则恢复原文
    if (tabState?.isTranslated) {
      await restoreOriginal(tabId, webview);
      return;
    }

    // 如果正在翻译，再次点击视为取消
    if (tabState?.isTranslating) {
      if (currentTranslationTaskId) {
        ipcRenderer.send('cancel-translation', { taskId: currentTranslationTaskId });
      }
      streamingTranslationActive = false;
      currentTranslationTaskId = null;
      translationState.set(tabId, { isTranslated: false, isTranslating: false });
      updateTranslateBtnState(tabId, 'normal');
      showToast(t('translation.cancelled') || '已取消翻译', 'info');
      return;
    }

    try {
      // 设置翻译中状态
      translationState.set(tabId, { isTranslated: false, isTranslating: true });
      updateTranslateBtnState(tabId, 'translating');
      showToast(t('translation.collecting') || '正在收集文本...', 'info');

      // 收集页面文本
      const collectResult = await webview.executeJavaScript(COLLECT_TEXT_SCRIPT);

      if (!collectResult || !collectResult.texts || collectResult.texts.length === 0) {
        showToast(t('translation.noText') || '未找到可翻译的文本', 'warning');
        translationState.set(tabId, { isTranslated: false, isTranslating: false });
        updateTranslateBtnState(tabId, 'normal');
        return;
      }

      const { texts, nodes } = collectResult;
      currentTranslationNodes = nodes;
      streamingTranslationActive = true;
      currentTranslationTaskId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      // 获取目标语言
      const targetLanguage = store.get('settings.translationTargetLanguage', '简体中文');

      showToast(
        `${t('translation.translating') || '正在翻译'}... (${texts.length} ${t('translation.texts') || '个文本块'})`,
        'info'
      );

      // 调用主进程翻译
      const result = await ipcRenderer.invoke('translate-text', {
        texts,
        targetLanguage,
        taskId: currentTranslationTaskId
      });

      streamingTranslationActive = false;
      currentTranslationTaskId = null;

      if (result && result.cancelled) {
        translationState.set(tabId, { isTranslated: false, isTranslating: false });
        updateTranslateBtnState(tabId, 'normal');
        return;
      }

      if (!result.success) {
        throw new Error(result.error || '翻译失败');
      }

      // 如果不是流式翻译，或者流式更新没有完全应用，则应用完整翻译
      // 流式翻译过程中已经逐步应用了结果，这里作为兜底确保所有翻译都已应用
      const script = APPLY_TRANSLATION_SCRIPT.replace(
        '__TRANSLATIONS__',
        JSON.stringify(result.translations)
      ).replace('__NODE_DATA__', JSON.stringify(nodes));

      await webview.executeJavaScript(script);

      // 更新状态
      translationState.set(tabId, {
        isTranslated: true,
        isTranslating: false,
        nodeData: nodes
      });
      updateTranslateBtnState(tabId, 'translated');
      showToast(t('translation.completed') || '翻译完成', 'success');
    } catch (error) {
      console.error('Translation error:', error);
      streamingTranslationActive = false;
      currentTranslationTaskId = null;
      translationState.set(tabId, { isTranslated: false, isTranslating: false });
      updateTranslateBtnState(tabId, 'normal');
      showToast(`${t('translation.failed') || '翻译失败'}: ${error.message}`, 'error');
    }
  }

  /**
   * 恢复原文
   */
  async function restoreOriginal(tabId, webview) {
    try {
      await webview.executeJavaScript(RESTORE_ORIGINAL_SCRIPT);

      translationState.set(tabId, { isTranslated: false, isTranslating: false });
      currentTranslationNodes = null;
      updateTranslateBtnState(tabId, 'normal');
      showToast(t('translation.restored') || '已恢复原文', 'success');
    } catch (error) {
      console.error('Restore error:', error);
      showToast(t('translation.restoreFailed') || '恢复失败', 'error');
    }
  }

  /**
   * 监听翻译进度
   */
  function setupProgressListener() {
    ipcRenderer.on('translation-progress', (event, data) => {
      if (currentTranslationTaskId && data.taskId && data.taskId !== currentTranslationTaskId) {
        return;
      }
      if (data.status === 'cancelled') {
        showToast(t('translation.cancelled') || '已取消翻译', 'info');
        return;
      }
      if (data.status === 'translating') {
        showToast(
          `${t('translation.translatingChunk') || '正在翻译'} ${data.current}/${data.total}`,
          'info'
        );
      }
    });

    // 监听流式翻译更新
    ipcRenderer.on('translation-streaming', async (_event, data) => {
      if (!streamingTranslationActive || !currentTranslationNodes) return;
      if (currentTranslationTaskId && data.taskId && data.taskId !== currentTranslationTaskId)
        return;

      const webview = getActiveWebview();
      if (!webview || webview.tagName !== 'WEBVIEW') return;

      // 应用新完成的翻译
      const globalStartIndex =
        data.startIndex +
        (typeof data.newTextsStartIndex === 'number' ? data.newTextsStartIndex : 0);
      await applyStreamingTranslation(webview, data.newTexts, globalStartIndex);
    });
  }

  /**
   * 绑定事件
   */
  function bindEvents() {
    const translateBtn = getTranslateBtn();

    if (translateBtn) {
      translateBtn.style.display = 'flex';
      translateBtn.addEventListener('click', handleTranslate);
    }

    setupProgressListener();
  }

  /**
   * 清理标签页翻译状态
   */
  function clearTabState(tabId) {
    translationState.delete(tabId);
    if (getActiveTabId() === tabId) {
      currentTranslationNodes = null;
      streamingTranslationActive = false;
      currentTranslationTaskId = null;
    }
  }

  return {
    bindEvents,
    handleTranslate,
    clearTabState,
    updateTranslateBtnState
  };
}

module.exports = {
  createTranslationManager
};
