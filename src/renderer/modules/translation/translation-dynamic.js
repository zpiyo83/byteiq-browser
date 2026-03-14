/**
 * 动态翻译控制器
 * 负责监听网页动态变化并应用翻译
 */

function createDynamicTranslationController(options) {
  const {
    store,
    ipcRenderer,
    documentRef,
    translationState,
    dynamicTranslationActive,
    runtimeState,
    applyTranslationScript,
    setTranslatedStateScript,
    setupDynamicListenerScript,
    teardownDynamicListenerScript
  } = options;

  /**
   * 检查动态翻译是否启用
   */
  function isDynamicTranslationEnabled() {
    return store.get('settings.translationDynamicEnabled', true);
  }

  /**
   * 设置动态翻译监听器
   */
  async function setupDynamicTranslation(webview, tabId) {
    if (!isDynamicTranslationEnabled()) return;

    try {
      // 设置翻译状态
      const setStateScript = setTranslatedStateScript.replace('__IS_TRANSLATED__', 'true');
      await webview.executeJavaScript(setStateScript);

      // 启动动态监听
      await webview.executeJavaScript(setupDynamicListenerScript);
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
      await webview.executeJavaScript(teardownDynamicListenerScript);
      dynamicTranslationActive.set(tabId, false);
    } catch (error) {
      console.error('Failed to teardown dynamic translation:', error);
    }
  }

  /**
   * 处理动态翻译请求
   */
  async function handleDynamicTranslation(webview, tabId, texts, nodeData) {
    if (runtimeState.dynamicTranslationInProgress) return;
    if (!isDynamicTranslationEnabled()) return;

    const tabState = translationState.get(tabId);
    if (!tabState?.isTranslated) return;

    runtimeState.dynamicTranslationInProgress = true;

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
            const script = applyTranslationScript.replace(
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
      runtimeState.dynamicTranslationInProgress = false;
    }
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

  return {
    setupDynamicTranslation,
    teardownDynamicTranslation,
    setupDynamicTranslationListener
  };
}

module.exports = {
  createDynamicTranslationController
};
