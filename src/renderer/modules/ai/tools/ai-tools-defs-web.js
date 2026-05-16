/**
 * AI 工具定义 - 网页操作类
 * 包含 get_page_info, click_element, input_text, search_page
 */

const { clickElement, inputText } = require('../agent/ai-webview-bridge');

const webToolDefs = [
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
          console.warn('[ai-tools-defs-web] Failed to extract page info after click:', error);
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
    name: 'close_tab',
    description:
      '关闭指定标签页。不传tab_id则关闭当前活跃标签页。关闭后浏览器自动切换到相邻标签页。已固定的标签页无法关闭。',
    parameters: {
      type: 'object',
      properties: {
        tab_id: {
          type: 'string',
          description: '要关闭的标签页ID，可选，默认当前活跃标签页'
        }
      }
    },
    async execute(context, args) {
      const tabId = args?.tab_id || context.getActiveTabId?.() || '';
      if (!tabId) {
        return { success: false, error: 'No tab to close' };
      }
      // 检查标签页是否固定
      const tab = typeof context.getTabById === 'function' ? context.getTabById(tabId) : null;
      if (tab && tab.pinned) {
        return { success: false, error: '已固定的标签页不能关闭' };
      }
      if (typeof context.closeTab !== 'function') {
        return { success: false, error: 'Cannot close tab' };
      }
      context.closeTab(tabId);
      return {
        success: true,
        tabId,
        message: '已关闭标签页'
      };
    }
  },
  {
    name: 'dispatch_background_task',
    description:
      '派发任务给后台模型执行。后台模型会独立处理任务,前台会等待任务完成(最多5分钟)后继续。',
    parameters: {
      type: 'object',
      properties: {
        task_query: {
          type: 'string',
          description: '要发给后台模型执行的任务描述或问题'
        }
      },
      required: ['task_query']
    },
    async execute(context, args) {
      const taskQuery = args?.task_query;

      if (!taskQuery) {
        return { success: false, error: 'Missing task_query' };
      }

      // 检查是否有后台任务管理器
      const bgTaskRunner = context.getBgTaskRunner?.();
      if (!bgTaskRunner || typeof bgTaskRunner.runBackgroundTask !== 'function') {
        return { success: false, error: 'Background task runner not available' };
      }

      // 派发后台任务(强制等待模式)
      try {
        const result = await bgTaskRunner.runBackgroundTask(taskQuery, true);

        // 等待模式：runBackgroundTask 返回的是 Promise，resolve 后包含完整结果
        // 直接返回结果给前台模型
        return {
          success: true,
          taskId: result.taskId,
          result: result.result || '',
          toolCallHistory: result.toolCallHistory || [],
          status: result.status,
          message: result.message || '后台任务已完成'
        };
      } catch (error) {
        return {
          success: false,
          error: error?.message || 'Failed to dispatch background task'
        };
      }
    }
  },
  {
    name: 'wait_seconds',
    description: '暂停指定秒数后再继续处理。用于等待外部操作完成或延迟执行。',
    parameters: {
      type: 'object',
      properties: {
        seconds: {
          type: 'number',
          description: '要等待的秒数,范围: 1-300秒'
        }
      },
      required: ['seconds']
    },
    async execute(context, args) {
      const seconds = args?.seconds;

      if (!seconds || typeof seconds !== 'number' || seconds < 1 || seconds > 300) {
        return { success: false, error: 'Invalid seconds, must be between 1 and 300' };
      }

      // 返回等待标记,由 agent-runner 处理实际等待
      return {
        success: true,
        waitMode: true,
        waitSeconds: seconds,
        message: `等待 ${seconds} 秒后继续...`
      };
    }
  }
];

module.exports = {
  webToolDefs
};
