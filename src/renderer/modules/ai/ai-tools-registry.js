/**
 * AI 工具注册表
 * 统一工具定义（schema + 执行）以减少重复与漂移
 */

const { clickElement, inputText } = require('./ai-webview-bridge');

function getAiToolDefinitions() {
  return [
    {
      name: 'get_page_info',
      description: '获取当前页面的URL、标题、内容摘要和可交互元素列表',
      parameters: {
        type: 'object',
        properties: {}
      },
      async execute(context) {
        const webview = context.getActiveWebview();
        if (!webview) {
          return { success: false, error: 'No active webview' };
        }
        const pageInfo = await context.extractPageContent(webview);
        return pageInfo || { success: false, error: 'Failed to get page info' };
      }
    },
    {
      name: 'click_element',
      description: '点击页面上的元素',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS选择器或元素ID' }
        },
        required: ['selector']
      },
      async execute(context, args) {
        const webview = context.getActiveWebview();
        if (!webview) {
          return { success: false, error: 'No active webview' };
        }
        return clickElement(webview, {
          selector: String(args.selector || '')
        });
      }
    },
    {
      name: 'input_text',
      description: '在输入框中输入文本',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS选择器或元素ID' },
          text: { type: 'string', description: '要输入的文本' }
        },
        required: ['selector', 'text']
      },
      async execute(context, args) {
        const webview = context.getActiveWebview();
        if (!webview) {
          return { success: false, error: 'No active webview' };
        }
        return inputText(webview, {
          selector: String(args.selector || ''),
          text: String(args.text || '')
        });
      }
    },
    {
      name: 'end_session',
      description: '当任务完成时调用此工具结束会话',
      parameters: {
        type: 'object',
        properties: {}
      },
      async execute() {
        return { success: true, ended: true };
      }
    }
  ];
}

function buildToolSchema(def) {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters
    }
  };
}

function getAiToolsSchema() {
  return getAiToolDefinitions().map(buildToolSchema);
}

function getAiToolByName(name) {
  return getAiToolDefinitions().find(def => def.name === name) || null;
}

module.exports = {
  getAiToolsSchema,
  getAiToolDefinitions,
  getAiToolByName
};
