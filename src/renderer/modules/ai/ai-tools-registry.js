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
        '【核心工具】添加待办项。' +
        '【触发场景】用户说"要做..."、"需要..."、"记得..."、"有个任务..."；或执行多步骤工作时，拆分每个步骤为独立待办项；' +
        '【优先级】high=紧急/截止期限/用户强调; medium=常规任务(默认); low=可选/优化项。' +
        '【最佳实践】复杂任务前先 list_todos → 逐步 add_todo → complete_todo标记完成。' +
        '【标题规范】使用清晰的行动词：「阅读XX文档」「完成XX代码」而不是「XX相关」。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '待办项标题（清晰的行动项，≤200字）',
            maxLength: 200
          },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'high=紧急/有期限; medium=常规(默认); low=可选'
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
        '【必用工具】显示待办项列表，支持筛选（pending/completed/all）。' +
        '【何时调用】用户问"还有什么要做"、"任务进度"、"还剩什么"；或执行复杂任务前检查现有待办；或完成待办后确认状态。' +
        '【默认模式】filter=pending（推荐，仅显示未完成）；定期调用 all 保持全局同步。' +
        '【ID提取】结果中 {id:xxx} 是后续调用 complete_todo/remove_todo 的唯一参数。' +
        '【最佳实践】开始任何复杂工作前必须先 list_todos("pending")，完成任务后再确认一次。',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['all', 'pending', 'completed'],
            description: 'pending=未完成(推荐); all=全部; completed=已完成'
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
        '【关键工具】标记待办项已完成。' +
        '【何时调用】任务步骤成功执行完毕且获得明确反馈后立即调用。' +
        '【获取ID】必须从 list_todos 结果中的 {id:xxx} 准确复制（否则操作失败）。' +
        '【操作流程】1.执行任务 → 2.验证成功 → 3.complete_todo(id) → 4.list_todos确认。' +
        '【注意】不要在任务完成前调用；已完成项会自动从 pending 视图消失。',
      parameters: {
        type: 'object',
        properties: {
          todo_id: {
            type: 'string',
            description:
              '待办项的 ID（从 list_todos 结果中的 {id:xxx} 提取，格式如 todo-1234567890-abcdefgh）'
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
      description:
        '【谨慎工具】删除待办项（不可恢复）。' +
        '【何时调用】仅当用户明确说"删除"、"取消"、"不需要"、"废弃"这个待办时调用。' +
        '【重要区分】已完成的项应用 complete_todo，不用 remove_todo。' +
        '【获取ID】从 list_todos 结果中的 {id:xxx} 提取。' +
        '【建议】删除前建议询问确认（"确定要删除xxx吗？"），以免误删。',
      parameters: {
        type: 'object',
        properties: {
          todo_id: {
            type: 'string',
            description: '待办项的 ID（从 list_todos 结果中的 {id:xxx} 提取）'
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
      description:
        '【必须调用】当任务完成、用户问题已解答、或已获取到所需信息时，必须立即调用此工具结束会话。' +
        '绝对不要在完成目标后继续获取信息或执行多余操作。' +
        '必须通过 summary 参数提供最终总结信息，将直接展示给用户。',
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
