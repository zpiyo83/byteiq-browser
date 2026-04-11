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
        properties: {
          tab_id: { type: 'string', description: '目标页面ID，可选，默认当前标签页' }
        }
      },
      async execute(context, args) {
        const tabId = args?.tab_id || '';
        const webview = tabId ? context.getWebviewById(tabId) : context.getActiveWebview();
        if (!webview) {
          return {
            success: false,
            error: tabId ? 'Target webview not found' : 'No active webview'
          };
        }
        const pageInfo = await context.extractPageContent(webview);
        if (!pageInfo) {
          return { success: false, error: 'Failed to get page info' };
        }
        return {
          ...pageInfo,
          tabId: tabId || ''
        };
      }
    },
    {
      name: 'click_element',
      description: '点击页面上的元素',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS选择器或元素ID' },
          tab_id: { type: 'string', description: '目标页面ID，可选，默认当前标签页' }
        },
        required: ['selector']
      },
      async execute(context, args) {
        const tabId = args?.tab_id || '';
        const webview = tabId ? context.getWebviewById(tabId) : context.getActiveWebview();
        if (!webview) {
          return {
            success: false,
            error: tabId ? 'Target webview not found' : 'No active webview'
          };
        }
        const result = await clickElement(webview, {
          selector: String(args?.selector || '')
        });

        // 点击成功后提取页面信息反馈给AI
        // 页面加载等待已在 ai-webview-bridge.js 中处理
        if (result.success) {
          try {
            const pageInfo = await context.extractPageContent(webview);
            if (pageInfo) {
              return {
                ...result,
                tabId: tabId || '',
                pageInfo: {
                  url: pageInfo.url || '',
                  title: pageInfo.title || '',
                  content: pageInfo.content ? pageInfo.content.substring(0, 2000) : ''
                }
              };
            }
          } catch (error) {
            console.warn('[ai-tools-registry] Failed to extract page info after click:', error);
            // 返回原始结果，不阻塞工具调用
          }
        }

        return {
          ...result,
          tabId: tabId || ''
        };
      }
    },
    {
      name: 'input_text',
      description: '在输入框中输入文本',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS选择器或元素ID' },
          text: { type: 'string', description: '要输入的文本' },
          tab_id: { type: 'string', description: '目标页面ID，可选，默认当前标签页' }
        },
        required: ['selector', 'text']
      },
      async execute(context, args) {
        const tabId = args?.tab_id || '';
        const webview = tabId ? context.getWebviewById(tabId) : context.getActiveWebview();
        if (!webview) {
          return {
            success: false,
            error: tabId ? 'Target webview not found' : 'No active webview'
          };
        }
        const result = await inputText(webview, {
          selector: String(args?.selector || ''),
          text: String(args?.text || '')
        });
        return {
          ...result,
          tabId: tabId || ''
        };
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
