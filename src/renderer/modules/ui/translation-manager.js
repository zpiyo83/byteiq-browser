/**
 * 翻译管理器
 * 负责页面翻译、状态管理、UI 交互
 */

const {
  COLLECT_TEXT_SCRIPT,
  APPLY_TRANSLATION_SCRIPT,
  RESTORE_ORIGINAL_SCRIPT,
  APPLY_SINGLE_TRANSLATION_SCRIPT,
  SET_TRANSLATED_STATE_SCRIPT,
  SETUP_DYNAMIC_LISTENER_SCRIPT,
  TEARDOWN_DYNAMIC_LISTENER_SCRIPT
} = require('../translation/translation-scripts');
const { createDynamicTranslationController } = require('../translation/translation-dynamic');
const { createTranslationProgressController } = require('../translation/translation-progress');

function createTranslationManager(options) {
  const { documentRef, store, t, showToast, ipcRenderer, getActiveTabId } = options;

  // 翻译状态
  const translationState = new Map(); // tabId -> { isTranslated, isTranslating, nodeData }

  const lastTranslatedUrlByTab = new Map(); // tabId -> url
  const pendingRetranslateUrlByTab = new Map(); // tabId -> url
  const pendingRetranslateTimerByTab = new Map(); // tabId -> timeoutId

  // 当前翻译任务信息（用于流式更新）
  const runtimeState = {
    currentTranslationNodes: null,
    streamingTranslationActive: false,
    currentTranslationTaskId: null,
    dynamicTranslationInProgress: false
  };

  // 动态翻译状态（按标签页追踪）
  const dynamicTranslationActive = new Map(); // tabId -> boolean

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

  function onActiveTabChanged(tabId) {
    if (!tabId) return;
    updateTranslateBtnState(tabId, 'normal');
  }

  const dynamicController = createDynamicTranslationController({
    store,
    ipcRenderer,
    documentRef,
    translationState,
    dynamicTranslationActive,
    runtimeState,
    applyTranslationScript: APPLY_TRANSLATION_SCRIPT,
    setTranslatedStateScript: SET_TRANSLATED_STATE_SCRIPT,
    setupDynamicListenerScript: SETUP_DYNAMIC_LISTENER_SCRIPT,
    teardownDynamicListenerScript: TEARDOWN_DYNAMIC_LISTENER_SCRIPT
  });

  const progressController = createTranslationProgressController({
    ipcRenderer,
    t,
    showToast,
    getActiveWebview,
    runtimeState,
    applySingleTranslationScript: APPLY_SINGLE_TRANSLATION_SCRIPT
  });
  const {
    setupDynamicTranslation,
    teardownDynamicTranslation,
    setupDynamicTranslationListener
  } = dynamicController;
  const { setupProgressListener } = progressController;

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
      runtimeState.currentTranslationNodes = nodes;
      runtimeState.streamingTranslationActive = true;
      const taskId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      runtimeState.currentTranslationTaskId = taskId;

      // 获取目标语言
      const targetLanguage = store.get('settings.translationTargetLanguage', '简体中文');

      const translatingLabel = t('translation.translating') || '正在翻译';
      const textLabel = t('translation.texts') || '个文本块';
      const translatingMessage = `${translatingLabel}... (${texts.length} ${textLabel})`;
      showToast(translatingMessage, 'info');

      // 调用主进程翻译
      const result = await ipcRenderer.invoke('translate-text', {
        texts,
        targetLanguage,
        taskId: runtimeState.currentTranslationTaskId
      });

      runtimeState.streamingTranslationActive = false;
      runtimeState.currentTranslationTaskId = null;

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
      runtimeState.streamingTranslationActive = false;
      runtimeState.currentTranslationTaskId = null;
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
      if (runtimeState.currentTranslationTaskId) {
        ipcRenderer.send('cancel-translation', { taskId: runtimeState.currentTranslationTaskId });
      }
      runtimeState.streamingTranslationActive = false;
      runtimeState.currentTranslationTaskId = null;
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
      runtimeState.currentTranslationNodes = null;
      updateTranslateBtnState(tabId, 'normal');
      showToast(t('translation.restored') || '已恢复原文', 'success');
    } catch (error) {
      console.error('Restore error:', error);
      showToast(t('translation.restoreFailed') || '恢复失败', 'error');
    }
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
      runtimeState.currentTranslationNodes = null;
      runtimeState.streamingTranslationActive = false;
      runtimeState.currentTranslationTaskId = null;
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

