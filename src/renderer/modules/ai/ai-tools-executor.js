/**
 * AI 工具执行器
 * 统一从注册表读取工具定义，并做参数校验
 */

const { getAiToolByName } = require('./ai-tools-registry');

function createAiToolsExecutor(options) {
  const { documentRef, getActiveTabId, extractPageContent, openTab, formatUrl, switchTab } =
    options;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getActiveWebview() {
    const tabId = getActiveTabId();
    if (!tabId) return null;
    const webview = documentRef.getElementById(`webview-${tabId}`);
    if (!webview || webview.tagName !== 'WEBVIEW' || !webview.isConnected) return null;
    return webview;
  }

  function getWebviewById(tabId) {
    if (!tabId) return null;
    const webview = documentRef.getElementById(`webview-${tabId}`);
    if (!webview || webview.tagName !== 'WEBVIEW' || !webview.isConnected) return null;
    return webview;
  }

  async function ensureTabActive(tabId, timeout = 100000) {
    if (!tabId) return { success: true };
    if (typeof switchTab === 'function' && getActiveTabId() !== tabId) {
      switchTab(tabId);
    }

    const start = Date.now();
    let webview = null;
    while (Date.now() - start < timeout) {
      webview = documentRef.getElementById(`webview-${tabId}`);
      if (webview && webview.isConnected) break;
      await sleep(50);
    }

    if (!webview || !webview.isConnected) {
      return { success: false, error: '目标页面尚未准备好，请稍后重试' };
    }

    if (webview.tagName !== 'WEBVIEW') {
      return { success: false, error: '目标标签页未打开网页，请先打开网页' };
    }

    if (webview.dataset && webview.dataset.domReady === 'true') {
      return { success: true };
    }

    if (typeof webview.isLoading === 'function' && !webview.isLoading()) {
      if (webview.dataset) {
        webview.dataset.domReady = 'true';
      }
      return { success: true };
    }

    const remaining = timeout - (Date.now() - start);
    if (remaining <= 0) {
      return { success: false, error: '目标页面尚未准备好，请稍后重试' };
    }

    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          webview.removeEventListener('dom-ready', onReady);
          reject(new Error('Webview dom-ready timeout'));
        }, remaining);

        function onReady() {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (webview.dataset) {
            webview.dataset.domReady = 'true';
          }
          webview.removeEventListener('dom-ready', onReady);
          resolve();
        }

        webview.addEventListener('dom-ready', onReady);
      });
    } catch (error) {
      return { success: false, error: '目标页面尚未准备好，请稍后重试' };
    }

    return { success: true };
  }

  function validateToolArgs(def, args) {
    const required = def.parameters?.required || [];
    for (const key of required) {
      if (args[key] === undefined || args[key] === null || args[key] === '') {
        return `Missing required argument: ${key}`;
      }
    }

    const props = def.parameters?.properties || {};
    for (const key of Object.keys(props)) {
      if (args[key] === undefined || args[key] === null) continue;
      const expectedType = props[key].type;
      if (expectedType && typeof args[key] !== expectedType) {
        return `Invalid argument type: ${key} should be ${expectedType}`;
      }
    }

    return '';
  }

  async function execute(toolCall) {
    try {
      if (!toolCall || !toolCall.name) {
        return { success: false, error: 'Invalid tool call' };
      }

      const def = getAiToolByName(toolCall.name);
      if (!def) {
        return { success: false, error: 'Unknown tool' };
      }

      const args = toolCall.arguments || {};
      const validationError = validateToolArgs(def, args);
      if (validationError) {
        return { success: false, error: validationError };
      }

      if (args.tab_id) {
        const ensureResult = await ensureTabActive(String(args.tab_id));
        if (ensureResult && ensureResult.success === false) {
          return ensureResult;
        }
      }

      const toolResult = await def.execute(
        {
          getActiveWebview,
          getWebviewById,
          extractPageContent,
          openTab,
          formatUrl,
          switchTab
        },
        args
      );

      return toolResult;
    } catch (error) {
      console.error('[ai-tools-executor] execute error:', error);
      return {
        success: false,
        error: error && error.message ? error.message : 'Tool execution failed'
      };
    }
  }

  return {
    execute
  };
}

module.exports = {
  createAiToolsExecutor
};
