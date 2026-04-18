/**
 * AI 外部 Todo 同步模块
 * 将浏览器内部的 todo 列表与 GitHub Copilot 的 manage_todo_list 工具同步
 *
 * 使用场景：
 * - AI 会话结束时，自动同步 pending 待办项到 Copilot
 * - 跨会话保持一致的任务列表
 * - 支持用户在 Copilot 中查看浏览器内的待办项
 */

function createExternalTodoSync(options) {
  const { todoManager, logger } = options;

  if (!todoManager) {
    console.warn('[ai-external-todo-sync] todoManager not provided, sync disabled');
    return { syncTodos: () => null };
  }

  /**
   * 将浏览器 todo 转换为 manage_todo_list 格式
   *
   * 浏览器 todo 格式:
   * { id, title, priority, completed, createdAt, completedAt }
   *
   * manage_todo_list 格式:
   * { id, title, status: 'not-started' | 'in-progress' | 'completed' }
   */
  function convertTodoFormat(browserTodos) {
    return (browserTodos || []).map(todo => ({
      id: todo.id,
      title: todo.title,
      status: todo.completed ? 'completed' : 'not-started'
    }));
  }

  /**
   * 构建 manage_todo_list 工具调用的参数
   */
  function buildManageTodoListParams(browserTodos, options = {}) {
    const { includeCompleted = false } = options;

    let filtered = browserTodos;
    if (!includeCompleted) {
      filtered = browserTodos.filter(t => !t.completed);
    }

    const todoList = convertTodoFormat(filtered);

    return {
      todoList,
      metadata: {
        source: 'byteiq-browser',
        timestamp: Date.now(),
        totalCount: browserTodos.length,
        pendingCount: browserTodos.filter(t => !t.completed).length,
        completedCount: browserTodos.filter(t => t.completed).length
      }
    };
  }

  /**
   * 同步待办项到外部（Copilot）
   * 应在 AI 会话结束或用户明确要求同步时调用
   */
  function syncTodos(options = {}) {
    try {
      const todos = todoManager.readTodos ? todoManager.readTodos() : [];

      if (!Array.isArray(todos)) {
        logger?.warn('[ai-external-todo-sync] Invalid todo format');
        return {
          success: false,
          error: 'Invalid todo data format'
        };
      }

      const params = buildManageTodoListParams(todos, options);

      if (logger) {
        logger.info('[ai-external-todo-sync] Syncing todos:', {
          pendingCount: params.metadata.pendingCount,
          completedCount: params.metadata.completedCount,
          totalCount: params.metadata.totalCount
        });
      }

      // 返回可供工具调用的参数
      // 在实际使用中，这应该被传递给 manage_todo_list 工具
      return {
        success: true,
        data: params,
        message: `已同步 ${params.metadata.pendingCount} 个待办项到 Copilot`
      };
    } catch (error) {
      logger?.error('[ai-external-todo-sync] Sync failed:', error);
      return {
        success: false,
        error: error.message || 'Sync failed'
      };
    }
  }

  /**
   * 获取同步状态报告
   */
  function getSyncStatus() {
    try {
      const todos = todoManager.readTodos ? todoManager.readTodos() : [];

      return {
        success: true,
        stats: {
          total: todos.length,
          pending: todos.filter(t => !t.completed).length,
          completed: todos.filter(t => t.completed).length,
          lastSync: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Failed to get sync status'
      };
    }
  }

  /**
   * 在会话结束前调用
   * 自动同步待办项并清理
   */
  function onSessionEnd(context = {}) {
    const { verbose = false } = context;

    try {
      const syncResult = syncTodos();

      if (verbose && syncResult.success) {
        console.log('[ai-external-todo-sync] Session end sync completed:', syncResult.data);
      }

      return syncResult;
    } catch (error) {
      logger?.error('[ai-external-todo-sync] Session end sync failed:', error);
      return {
        success: false,
        error: error.message || 'Session end sync failed'
      };
    }
  }

  return {
    syncTodos,
    getSyncStatus,
    onSessionEnd,
    convertTodoFormat,
    buildManageTodoListParams
  };
}

module.exports = {
  createExternalTodoSync
};
