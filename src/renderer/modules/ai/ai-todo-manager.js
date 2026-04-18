function createAiTodoManager(options) {
  const { store, getActiveSessionId } = options;

  const BASE_KEY = 'ai.todoList';
  const GLOBAL_KEY = 'ai.todoList.global'; // 备用的全局键，当 session ID 不可用时使用
  const DEBUG = false; // 设置为 true 时启用调试日志

  // 锁定的 session ID，agent 运行期间使用固定值避免标签页切换导致 session 变化
  let lockedSessionId = null;

  function lockSession(sessionId) {
    if (!sessionId) {
      console.warn(
        '[ai-todo-manager] Attempted to lock empty sessionId, using GLOBAL_KEY as fallback'
      );
    }
    lockedSessionId = sessionId;
    if (DEBUG) {
      console.log('[ai-todo-manager] Session locked:', sessionId);
    }
  }

  function unlockSession() {
    if (DEBUG) {
      console.log('[ai-todo-manager] Session unlocked, was:', lockedSessionId);
    }
    lockedSessionId = null;
  }

  function getSessionKey() {
    // 优先使用锁定的 session ID
    let sessionId = lockedSessionId;

    // 如果没有锁定，则获取当前活跃 session
    if (!sessionId && typeof getActiveSessionId === 'function') {
      sessionId = getActiveSessionId();
    }

    // 确定最终的存储键
    const key = sessionId ? `${BASE_KEY}.${sessionId}` : GLOBAL_KEY;

    if (DEBUG) {
      console.log('[ai-todo-manager] getSessionKey:', {
        lockedSessionId,
        sessionId,
        key,
        isUsingGlobalKey: !sessionId
      });
    }

    return key;
  }

  function readTodos() {
    const key = getSessionKey();
    const list = store ? store.get(key, []) : [];

    if (DEBUG) {
      console.log('[ai-todo-manager] readTodos:', { key, count: list.length, list });
    }

    // 如果当前键为空，尝试从全局键中读取（降级处理）
    if (list.length === 0 && key !== GLOBAL_KEY && store) {
      const globalList = store.get(GLOBAL_KEY, []);
      if (globalList.length > 0) {
        if (DEBUG) {
          console.log('[ai-todo-manager] Fallback to global todos:', globalList.length);
        }
        return Array.isArray(globalList) ? globalList : [];
      }
    }

    return Array.isArray(list) ? list : [];
  }

  function writeTodos(list) {
    if (!store) {
      if (DEBUG) console.warn('[ai-todo-manager] writeTodos: store not available');
      return;
    }

    const key = getSessionKey();
    if (DEBUG) {
      console.log('[ai-todo-manager] writeTodos:', { key, count: list.length });
    }

    store.set(key, list);

    // 如果使用了全局键，同时写入备份以保持同步
    if (key === GLOBAL_KEY && lockedSessionId) {
      const sessionKey = `${BASE_KEY}.${lockedSessionId}`;
      store.set(sessionKey, list);
      if (DEBUG) {
        console.log('[ai-todo-manager] Also wrote to session key:', sessionKey);
      }
    }
  }

  function generateId() {
    return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizePriority(priority) {
    const p = String(priority || 'medium');
    if (p === 'low' || p === 'high') return p;
    return 'medium';
  }

  function addTodo(title, priority) {
    const text = String(title || '').trim();
    if (!text) return { success: false, error: 'Title cannot be empty' };

    const todos = readTodos();
    const todo = {
      id: generateId(),
      title: text,
      priority: normalizePriority(priority),
      completed: false,
      createdAt: Date.now(),
      completedAt: null
    };
    todos.unshift(todo);
    writeTodos(todos);

    return { success: true, todo, message: `已添加待办项（ID: ${todo.id}）` };
  }

  function listTodos(filter) {
    const mode = String(filter || 'pending');
    const todos = readTodos();

    let filtered = todos;
    if (mode === 'pending') {
      filtered = todos.filter(t => !t.completed);
    } else if (mode === 'completed') {
      filtered = todos.filter(t => t.completed);
    }

    const display = filtered
      .map(t => {
        const mark = t.completed ? '[x]' : '[ ]';
        const pri = t.priority ? `(${t.priority})` : '';
        return `${mark} ${pri} ${t.title}  {id:${t.id}}`;
      })
      .join('\n');

    return {
      success: true,
      todos: filtered,
      display: display || '暂无待办项'
    };
  }

  function completeTodo(todoId) {
    const id = String(todoId || '').trim();
    if (!id) return { success: false, error: 'Todo ID cannot be empty' };

    const todos = readTodos();
    const idx = todos.findIndex(t => t.id === id);
    if (idx === -1) return { success: false, error: 'Todo not found' };

    todos[idx] = {
      ...todos[idx],
      completed: true,
      completedAt: Date.now()
    };
    writeTodos(todos);

    return { success: true, todo: todos[idx], message: `已完成待办项（ID: ${id}）` };
  }

  function removeTodo(todoId) {
    const id = String(todoId || '').trim();
    if (!id) return { success: false, error: 'Todo ID cannot be empty' };

    const todos = readTodos();
    const next = todos.filter(t => t.id !== id);
    if (next.length === todos.length) return { success: false, error: 'Todo not found' };
    writeTodos(next);

    return { success: true, message: `已删除待办项（ID: ${id}）` };
  }

  function editTodo(todoId, updates) {
    const id = String(todoId || '').trim();
    if (!id) return { success: false, error: 'Todo ID cannot be empty' };

    const todos = readTodos();
    const idx = todos.findIndex(t => t.id === id);
    if (idx === -1) return { success: false, error: 'Todo not found' };

    const todo = todos[idx];
    const changes = {};

    // 更新标题
    if (updates.title !== undefined) {
      const newTitle = String(updates.title || '').trim();
      if (!newTitle) return { success: false, error: 'Title cannot be empty' };
      changes.title = newTitle;
    }

    // 更新优先级
    if (updates.priority !== undefined) {
      changes.priority = normalizePriority(updates.priority);
    }

    // 更新完成状态
    if (updates.completed !== undefined) {
      const isCompleted = Boolean(updates.completed);
      if (isCompleted && !todo.completed) {
        changes.completed = true;
        changes.completedAt = Date.now();
      } else if (!isCompleted && todo.completed) {
        changes.completed = false;
        changes.completedAt = null;
      }
    }

    if (Object.keys(changes).length === 0) {
      return { success: true, todo, message: '没有要更新的字段' };
    }

    todos[idx] = { ...todo, ...changes };
    writeTodos(todos);

    return { success: true, todo: todos[idx], message: `已更新待办项（ID: ${id}）` };
  }

  function getTodoDetails(todoId) {
    const id = String(todoId || '').trim();
    if (!id) return { success: false, error: 'Todo ID cannot be empty' };

    const todos = readTodos();
    const todo = todos.find(t => t.id === id);

    if (!todo) return { success: false, error: 'Todo not found' };

    const now = Date.now();
    const createdDate = new Date(todo.createdAt);
    const completedDate = todo.completedAt ? new Date(todo.completedAt) : null;
    const durationMs = todo.completedAt ? todo.completedAt - todo.createdAt : now - todo.createdAt;

    return {
      success: true,
      todo: {
        ...todo,
        createdAtFormatted: createdDate.toLocaleString('zh-CN'),
        completedAtFormatted: completedDate ? completedDate.toLocaleString('zh-CN') : null,
        durationHours: Math.round((durationMs / 3600000) * 10) / 10,
        status: todo.completed ? 'completed' : 'pending'
      },
      message: `获取待办项详情（ID: ${id}）`
    };
  }

  function buildTodoPrompt() {
    const todos = readTodos();
    const pending = todos.filter(t => !t.completed);
    const completed = todos.filter(t => t.completed);

    const formatLines = list =>
      list
        .map(t => {
          const mark = t.completed ? '[x]' : '[ ]';
          const pri = t.priority ? `(${t.priority})` : '';
          return `- ${mark} ${pri} ${t.title} (id: ${t.id})`;
        })
        .join('\n');

    const pendingText = pending.length ? formatLines(pending) : '- (empty)';
    const completedText = completed.length ? formatLines(completed) : '- (empty)';

    return (
      '\n\n[To Do List - Highest Priority]\n' +
      '以下 To Do 列表为最高优先级指令，必须始终考虑并保持同步。\n' +
      '你可以使用工具 add_todo / list_todos / complete_todo / remove_todo 来维护此列表。\n\n' +
      '[Pending]\n' +
      pendingText +
      '\n\n[Completed]\n' +
      completedText
    );
  }

  /**
   * 诊断函数：显示所有存储的待办项（用于调试存储问题）
   */
  function diagnoseTodos() {
    if (!store) {
      return { success: false, error: 'Store not available' };
    }

    const diagnosis = {
      currentKey: getSessionKey(),
      lockedSessionId,
      globalKey: GLOBAL_KEY,
      allTodoKeys: [],
      allTodos: {},
      currentTodos: {
        key: getSessionKey(),
        count: 0,
        items: []
      }
    };

    // 读取当前键的待办项
    const currentTodos = readTodos();
    diagnosis.currentTodos.count = currentTodos.length;
    diagnosis.currentTodos.items = currentTodos;

    // 扫描所有以 BASE_KEY 开头的键
    const storeData = store.store || {};
    for (const key in storeData) {
      if (key.startsWith(BASE_KEY)) {
        const value = storeData[key];
        diagnosis.allTodoKeys.push(key);
        diagnosis.allTodos[key] = {
          count: Array.isArray(value) ? value.length : 0,
          items: Array.isArray(value) ? value : []
        };
      }
    }

    if (DEBUG) {
      console.log('[ai-todo-manager] Diagnosis:', diagnosis);
    }

    return {
      success: true,
      diagnosis
    };
  }

  return {
    addTodo,
    listTodos,
    completeTodo,
    removeTodo,
    editTodo,
    getTodoDetails,
    buildTodoPrompt,
    diagnoseTodos,
    lockSession,
    unlockSession,
    readTodos,
    writeTodos
  };
}

module.exports = {
  createAiTodoManager
};
