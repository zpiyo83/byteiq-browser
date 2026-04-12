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
        '新建标签页并搜索指定内容，返回新标签页的tab_id。页面加载后请使用get_page_info获取页面信息。',
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

        // 切换到新标签页
        if (typeof context.switchTab === 'function') {
          context.switchTab(tabId);
        }

        // 等待新标签页的 WebView 节点真正出现在 DOM 中
        const start = Date.now();
        const waitTimeout = 10000;
        while (Date.now() - start < waitTimeout) {
          const wv = context.getWebviewById(tabId);
          if (wv && wv.isConnected) {
            break;
          }
          await new Promise(r => setTimeout(r, 100));
        }

        return {
          success: true,
          tabId,
          message: `已打开搜索页面，请使用 get_page_info(tab_id="${tabId}") 获取内容。`
        };
      }
    },
    {
      name: 'add_todo',
      description:
        '添加一个新的待办项到To do列表。当用户提到任务、计划、要做的事、待办、提醒时必须调用此工具。执行多步骤任务时，应将每个步骤拆分为待办项。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '待办项的标题/内容'
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: '优先级：low(低)、medium(中)、high(高)，默认为medium'
          }
        },
        required: ['title']
      },
      async execute(context, args) {
        const title = String(args?.title || '').trim();
        if (!title) {
          return { success: false, error: 'Title cannot be empty' };
        }
        const priority = args?.priority || 'medium';
        const result = context.getTodoManager().addTodo(title, priority);
        return result;
      }
    },
    {
      name: 'list_todos',
      description:
        '显示所有待办项，可选按优先级或完成状态筛选。当用户询问待办列表、任务进度、还有什么没做时必须调用。每次开始新任务前也应调用此工具查看现有待办。',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['all', 'pending', 'completed'],
            description: '筛选条件：all(全部)、pending(未完成)、completed(已完成)，默认为pending'
          }
        }
      },
      async execute(context, args) {
        const filter = args?.filter || 'pending';
        const result = context.getTodoManager().listTodos(filter);
        return result;
      }
    },
    {
      name: 'complete_todo',
      description:
        '标记待办项为已完成。当某个待办项对应的任务步骤已经执行完毕时，必须调用此工具将其标记为完成。',
      parameters: {
        type: 'object',
        properties: {
          todo_id: {
            type: 'string',
            description: '待办项的ID'
          }
        },
        required: ['todo_id']
      },
      async execute(context, args) {
        const todoId = String(args?.todo_id || '').trim();
        if (!todoId) {
          return { success: false, error: 'Todo ID cannot be empty' };
        }
        const result = context.getTodoManager().completeTodo(todoId);
        return result;
      }
    },
    {
      name: 'remove_todo',
      description: '从To do列表中删除一个待办项。当用户要求删除、取消某个待办项时调用。',
      parameters: {
        type: 'object',
        properties: {
          todo_id: {
            type: 'string',
            description: '待办项的ID'
          }
        },
        required: ['todo_id']
      },
      async execute(context, args) {
        const todoId = String(args?.todo_id || '').trim();
        if (!todoId) {
          return { success: false, error: 'Todo ID cannot be empty' };
        }
        const result = context.getTodoManager().removeTodo(todoId);
        return result;
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
