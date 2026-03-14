/**
 * 翻译进度与流式更新处理
 */

function createTranslationProgressController(options) {
  const {
    ipcRenderer,
    t,
    showToast,
    getActiveWebview,
    runtimeState,
    applySingleTranslationScript
  } = options;

  /**
   * 应用流式翻译结果
   */
  async function applyStreamingTranslation(webview, newTexts, startIndex) {
    if (!runtimeState.currentTranslationNodes || !newTexts || newTexts.length === 0) return;

    for (let i = 0; i < newTexts.length; i++) {
      const globalIndex = startIndex + i;
      const nodeInfo = runtimeState.currentTranslationNodes[globalIndex];
      const translation = newTexts[i];

      if (nodeInfo && translation) {
        const script = applySingleTranslationScript.replace(
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
   * 监听翻译进度
   */
  function setupProgressListener() {
    ipcRenderer.on('translation-progress', (event, data) => {
      if (
        runtimeState.currentTranslationTaskId &&
        data.taskId &&
        data.taskId !== runtimeState.currentTranslationTaskId
      ) {
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
      if (!runtimeState.streamingTranslationActive || !runtimeState.currentTranslationNodes) return;
      if (
        runtimeState.currentTranslationTaskId &&
        data.taskId &&
        data.taskId !== runtimeState.currentTranslationTaskId
      ) {
        return;
      }

      const webview = getActiveWebview();
      if (!webview || webview.tagName !== 'WEBVIEW') return;

      // 应用新完成的翻译
      const globalStartIndex =
        data.startIndex +
        (typeof data.newTextsStartIndex === 'number' ? data.newTextsStartIndex : 0);
      await applyStreamingTranslation(webview, data.newTexts, globalStartIndex);
    });
  }

  return {
    setupProgressListener
  };
}

module.exports = {
  createTranslationProgressController
};
