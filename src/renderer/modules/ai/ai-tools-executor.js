/**
 * AI 工具执行器
 * 统一从注册表读取工具定义，并做参数校验
 */

const { getAiToolByName } = require('./ai-tools-registry');

function createAiToolsExecutor(options) {
  const { documentRef, getActiveTabId, extractPageContent } = options;

  function getActiveWebview() {
    const tabId = getActiveTabId();
    if (!tabId) return null;
    const webview = documentRef.getElementById(`webview-${tabId}`);
    if (!webview || webview.tagName !== 'WEBVIEW') return null;
    return webview;
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

    return def.execute(
      {
        getActiveWebview,
        extractPageContent
      },
      args
    );
  }

  return {
    execute
  };
}

module.exports = {
  createAiToolsExecutor
};
