/**
 * AI 工具执行器
 * 统一从注册表读取工具定义，并做参数校验
 * 性能优化：工具定义缓存、DOM 查询优化
 */

const { getAiToolByName } = require('./ai-tools-registry');

function createAiToolsExecutor(options) {
  const {
    documentRef,
    getActiveTabId,
    extractPageContent,
    openTab,
    formatUrl,
    switchTab,
    bindTabToSession,
    getTodoManager,
    store
  } = options;

  // 性能优化：工具定义缓存（LRU，最多缓存 50 个工具）
  const toolDefCache = new Map();
  const CACHE_MAX_SIZE = 50;

  function getToolDef(toolName) {
    // 先从缓存查询
    if (toolDefCache.has(toolName)) {
      return toolDefCache.get(toolName);
    }

    // 从注册表获取，然后缓存
    const def = getAiToolByName(toolName, store);
    if (def && toolDefCache.size < CACHE_MAX_SIZE) {
      toolDefCache.set(toolName, def);
    }
    return def;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 缓存最后查询的 webview 及其 ID，避免频繁 DOM 查询
  let lastActiveTabId = null;
  let cachedActiveWebview = null;

  function getActiveWebview() {
    const tabId = getActiveTabId();

    // 如果 tabId 没变，返回缓存的 webview
    if (tabId === lastActiveTabId && cachedActiveWebview && cachedActiveWebview.isConnected) {
      return cachedActiveWebview;
    }

    if (!tabId) {
      cachedActiveWebview = null;
      lastActiveTabId = null;
      return null;
    }

    const webview = documentRef.getElementById(`webview-${tabId}`);
    if (!webview || webview.tagName !== 'WEBVIEW' || !webview.isConnected) {
      cachedActiveWebview = null;
      lastActiveTabId = null;
      return null;
    }

    // 缓存结果
    cachedActiveWebview = webview;
    lastActiveTabId = tabId;
    return webview;
  }

  function getWebviewById(tabId) {
    if (!tabId) return null;

    // 如果查询的是当前活跃 tab，使用缓存
    if (tabId === lastActiveTabId && cachedActiveWebview && cachedActiveWebview.isConnected) {
      return cachedActiveWebview;
    }

    const webview = documentRef.getElementById(`webview-${tabId}`);
    if (!webview || webview.tagName !== 'WEBVIEW' || !webview.isConnected) return null;

    // 如果这是活跃 tab，缓存它
    if (tabId === getActiveTabId()) {
      cachedActiveWebview = webview;
      lastActiveTabId = tabId;
    }

    return webview;
  }

  async function ensureTabActive(tabId, timeout = 10000) {
    if (!tabId) return { success: true };
    if (typeof switchTab === 'function' && getActiveTabId() !== tabId) {
      switchTab(tabId);
    }

    const start = Date.now();
    let webview = null;

    // 性能优化：优化轮询间隔从 50ms 改为 20ms，总超时时间保持
    const POLL_INTERVAL = 20;

    while (Date.now() - start < timeout) {
      webview = documentRef.getElementById(`webview-${tabId}`);
      if (webview && webview.isConnected) break;
      await sleep(POLL_INTERVAL);
    }

    if (!webview || !webview.isConnected) {
      return { success: false, error: '目标页面尚未准备好，请稍后重试' };
    }

    if (webview.tagName !== 'WEBVIEW') {
      return { success: false, error: '目标标签页未打开网页，请先打开网页' };
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

      // 性能优化：使用缓存的工具定义
      const def = getToolDef(toolCall.name);
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
          switchTab,
          bindTabToSession,
          getTodoManager
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

  // 暴露清除缓存方法（用于测试或手动清理）
  function clearCache() {
    toolDefCache.clear();
    cachedActiveWebview = null;
    lastActiveTabId = null;
  }

  return {
    execute,
    clearCache
  };
}

module.exports = {
  createAiToolsExecutor
};
