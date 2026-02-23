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

// 设置翻译状态脚本
const SET_TRANSLATED_STATE_SCRIPT = `
(function(isTranslated) {
  window.__byteiqIsTranslated = isTranslated;
})(__IS_TRANSLATED__);
`;

// 动态翻译监听脚本
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

// 清理动态翻译监听脚本
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

function createTranslationManager(options) {
  const { documentRef, store, t, showToast, ipcRenderer, getActiveTabId } = options;

  // 翻译状态
  const translationState = new Map(); // tabId -> { isTranslated, isTranslating, nodeData }

  const lastTranslatedUrlByTab = new Map(); // tabId -> url
  const pendingRetranslateUrlByTab = new Map(); // tabId -> url
  const pendingRetranslateTimerByTab = new Map(); // tabId -> timeoutId

  // 当前翻译任务信息（��于流式更新）
  let currentTranslationNodes = null;
  let streamingTranslationActive = false;
  let currentTranslationTaskId = null;

  // 动态翻译状态（按标签页追踪）
  const dynamicTranslationActive = new Map(); // tabId -> boolean

  // 动态翻译任务队列（防止并发翻译）
  let dynamicTranslationInProgress = false;

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
   * 检查动态翻译是否启用
   */
  function isDynamicTranslationEnabled() {
    return store.get('settings.translationDynamicEnabled', true);
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

  function onActiveTabChanged(tabId) {
    if (!tabId) return;
    updateTranslateBtnState(tabId, 'normal');
  }

  /**
   * 设置动态翻译监听器
   */
  async function setupDynamicTranslation(webview, tabId) {
    if (!isDynamicTranslationEnabled()) return;

    try {
      // 设置翻译状态
      const setStateScript = SET_TRANSLATED_STATE_SCRIPT.replace('__IS_TRANSLATED__', 'true');
      await webview.executeJavaScript(setStateScript);

      // 启动动态监听
      await webview.executeJavaScript(SETUP_DYNAMIC_LISTENER_SCRIPT);
      dynamicTranslationActive.set(tabId, true);
    } catch (error) {
      console.error('Failed to setup dynamic translation:', error);
    }
  }

  /**
   * 清理动态翻译监听器
   */
  async function teardownDynamicTranslation(webview, tabId) {
    try {
      await webview.executeJavaScript(TEARDOWN_DYNAMIC_LISTENER_SCRIPT);
      dynamicTranslationActive.set(tabId, false);
    } catch (error) {
      console.error('Failed to teardown dynamic translation:', error);
    }
  }

  /**
   * 处理动态翻译请求
   */
  async function handleDynamicTranslation(webview, tabId, texts, nodeData) {
    if (dynamicTranslationInProgress) return;
    if (!isDynamicTranslationEnabled()) return;

    const tabState = translationState.get(tabId);
    if (!tabState?.isTranslated) return;

    dynamicTranslationInProgress = true;

    try {
      const targetLanguage = store.get('settings.translationTargetLanguage', '简体中文');

      // 调用主进程翻译（使用单文本翻译接口）
      const result = await ipcRenderer.invoke('translate-single-text', {
        texts,
        targetLanguage
      });

      if (result.success && result.translations) {
        // 应用翻译结果
        for (let i = 0; i < result.translations.length; i++) {
          const translation = result.translations[i];
          const nodeInfo = nodeData[i];

          if (translation && nodeInfo) {
            const script = APPLY_TRANSLATION_SCRIPT.replace(
              '__TRANSLATIONS__',
              JSON.stringify([translation])
            ).replace('__NODE_DATA__', JSON.stringify([nodeInfo]));

            try {
              await webview.executeJavaScript(script);
            } catch (e) {
              console.error('Failed to apply dynamic translation:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Dynamic translation error:', error);
    } finally {
      dynamicTranslationInProgress = false;
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

  async function translateWebview(tabId, webview) {
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
      lastTranslatedUrlByTab.set(tabId, webview.getURL());
      showToast(t('translation.completed') || '翻译完成', 'success');

      // 启动动态翻译监听
      await setupDynamicTranslation(webview, tabId);
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

    await translateWebview(tabId, webview);
  }

  async function onWebviewUrlChanged({ id, kind, url, webview }) {
    if (!id || !webview || webview.tagName !== 'WEBVIEW') return;

    const activeTabId = getActiveTabId();
    if (id !== activeTabId) return;

    const tabState = translationState.get(id);
    if (!tabState?.isTranslated) return;
    if (tabState?.isTranslating) return;

    const lastUrl = lastTranslatedUrlByTab.get(id);
    if (!url || url === lastUrl) return;

    console.warn('[translation] url changed, schedule retranslate', {
      id,
      kind,
      url,
      lastUrl
    });

    pendingRetranslateUrlByTab.set(id, url);

    if (kind === 'did-navigate-in-page') {
      const existingTimer = pendingRetranslateTimerByTab.get(id);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timerId = setTimeout(async () => {
        pendingRetranslateTimerByTab.delete(id);

        const activeTabIdNow = getActiveTabId();
        if (id !== activeTabIdNow) return;

        const tabStateNow = translationState.get(id);
        if (!tabStateNow?.isTranslated) return;
        if (tabStateNow?.isTranslating) return;

        const pendingUrl = pendingRetranslateUrlByTab.get(id);
        const currentUrl = webview.getURL();
        if (!pendingUrl || !currentUrl || currentUrl !== pendingUrl) return;

        console.warn('[translation] retranslate triggered (in-page)', {
          id,
          pendingUrl,
          currentUrl
        });

        pendingRetranslateUrlByTab.delete(id);
        await restoreOriginal(id, webview);
        await translateWebview(id, webview);
      }, 800);

      pendingRetranslateTimerByTab.set(id, timerId);
    }
  }

  async function onWebviewDidStopLoading(webview, tabId) {
    if (!tabId || !webview || webview.tagName !== 'WEBVIEW') return;

    const activeTabId = getActiveTabId();
    if (tabId !== activeTabId) return;

    const tabState = translationState.get(tabId);
    if (!tabState?.isTranslated) return;
    if (tabState?.isTranslating) return;

    const pendingUrl = pendingRetranslateUrlByTab.get(tabId);
    if (!pendingUrl) return;

    const currentUrl = webview.getURL();
    if (!currentUrl || currentUrl !== pendingUrl) return;

    pendingRetranslateUrlByTab.delete(tabId);
    await restoreOriginal(tabId, webview);
    await translateWebview(tabId, webview);
  }

  /**
   * 恢复原文
   */
  async function restoreOriginal(tabId, webview) {
    try {
      // 先清理动态翻译监听器
      await teardownDynamicTranslation(webview, tabId);

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
    setupDynamicTranslationListener();
  }

  /**
   * 设置动态翻译消息监听
   */
  function setupDynamicTranslationListener() {
    // 监听来自 webview 的动态翻译请求
    // Electron 的 webview 通过 'ipc-message' 事件发送 sendToHost 消息
    documentRef.addEventListener('ipc-message', event => {
      const webview = event.target;
      if (!webview || webview.tagName !== 'WEBVIEW') return;

      if (event.channel === 'dynamic-translation-needed') {
        const tabId = webview.id.replace('webview-', '');
        const { texts, nodeData } = event.args[0];
        handleDynamicTranslation(webview, tabId, texts, nodeData);
      }
    });
  }

  /**
   * 清理标签页翻译状态
   */
  function clearTabState(tabId) {
    translationState.delete(tabId);
    dynamicTranslationActive.delete(tabId);
    lastTranslatedUrlByTab.delete(tabId);
    pendingRetranslateUrlByTab.delete(tabId);
    const timerId = pendingRetranslateTimerByTab.get(tabId);
    if (timerId) {
      clearTimeout(timerId);
      pendingRetranslateTimerByTab.delete(tabId);
    }
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
    updateTranslateBtnState,
    onActiveTabChanged,
    onWebviewUrlChanged,
    onWebviewDidStopLoading,
    setupDynamicTranslation,
    teardownDynamicTranslation
  };
}

module.exports = {
  createTranslationManager
};
