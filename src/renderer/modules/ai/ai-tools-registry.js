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
      name: 'search_page',
      description:
        '新建标签页并搜索指定内容，页面加载完成后返回页面信息。适用于需要在网上查找信息的场景。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词或短语'
          }
        },
        required: ['query']
      },
      async execute(context, args) {
        const query = args?.query;
        if (!query) {
          return { success: false, error: 'Missing search query' };
        }
        if (typeof context.openTab !== 'function') {
          return { success: false, error: 'Cannot create new tab' };
        }
        const tabId = context.openTab(query);
        if (!tabId) {
          return { success: false, error: 'Failed to create search tab' };
        }
        // 切换到新标签页并等待加载
        if (typeof context.switchTab === 'function') {
          context.switchTab(tabId);
        }
        // 等待 webview 元素出现
        const maxWait = 15000;
        const start = Date.now();
        let webview = null;
        while (Date.now() - start < maxWait) {
          webview = context.getWebviewById(tabId);
          if (webview) break;
          await new Promise(r => setTimeout(r, 200));
        }
        if (!webview) {
          return {
            success: true,
            tabId,
            title: '',
            url: '',
            content: '',
            message: '搜索页面已打开，但页面尚未加载完成，请使用 get_page_info 获取页面信息'
          };
        }
        // 短暂延迟确保 webview 完全挂载到 DOM
        await new Promise(r => setTimeout(r, 300));
        // extractPageContent 内部已有完整的 isConnected + dom-ready 等待逻辑
        try {
          const pageInfo = await context.extractPageContent(webview);
          if (pageInfo) {
            return {
              success: true,
              tabId,
              title: pageInfo.title || '',
              url: pageInfo.url || '',
              content: pageInfo.content ? pageInfo.content.substring(0, 3000) : '',
              controls: pageInfo.controls || []
            };
          }
        } catch (error) {
          console.warn('[ai-tools-registry] search_page extract failed:', error);
        }
        return {
          success: true,
          tabId,
          title: '',
          url: '',
          content: '',
          message: '搜索页面已打开，请使用 get_page_info 获取页面信息'
        };
      }
    },
    {
      name: 'end_session',
      description: '当任务完成时调用此工具结束会话，必须通过 summary 参数提供最终总结信息',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: '任务完成后的总结信息，将直接展示给用户，支持 Markdown 格式'
          }
        },
        required: ['summary']
      },
      async execute(_context, args) {
        return { success: true, ended: true, summary: args?.summary || '' };
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
