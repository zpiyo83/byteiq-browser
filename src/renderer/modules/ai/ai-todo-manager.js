function createAiTodoManager(options) {
  const { store, getActiveSessionId } = options;

  const BASE_KEY = 'ai.todoList';
  const GLOBAL_KEY = 'ai.todoList.global'; // 全局 fallback 键
  const DEBUG = false; // 设置为 true 时启用调试日志

  // 锁定的 session ID，agent 运行期间使用固定值避免标签页切换导致 session 变化
  let lockedSessionId = null;

  // 内存缓存：当前 session 的待办项，减少存储读写频率
  let inMemoryCache = null;
  let inMemoryCacheKey = null;

  function lockSession(sessionId) {
    lockedSessionId = sessionId;
    // 锁定时同步清空缓存，确保使用新 session 的数据
    inMemoryCache = null;
    inMemoryCacheKey = null;
    if (DEBUG) {
      console.log('[ai-todo-manager] Session locked:', sessionId);
    }
  }

  function unlockSession() {
    if (DEBUG) {
      console.log('[ai-todo-manager] Session unlocked, was:', lockedSessionId);
    }
    lockedSessionId = null;
    inMemoryCache = null;
    inMemoryCacheKey = null;
  }

  function getSessionKey() {
    // 优先使用锁定的 session ID（agent 运行期间固定）
    let sessionId = lockedSessionId;

    // 如果没有锁定，则获取当前活跃 session
    if (!sessionId && typeof getActiveSessionId === 'function') {
      sessionId = getActiveSessionId();
    }

    // 如果仍无 session ID，使用全局键作为 fallback
    const key = sessionId ? `${BASE_KEY}.${sessionId}` : GLOBAL_KEY;

    if (DEBUG) {
      console.log('[ai-todo-manager] getSessionKey:', {
        lockedSessionId,
        activeSessionId: sessionId,
        key,
        isGlobal: key === GLOBAL_KEY
      });
    }

    return key;
  }

  function readTodos() {
    const key = getSessionKey();

    // 检查内存缓存：如果键相同且缓存存在，深拷贝后返回
    if (inMemoryCacheKey === key && inMemoryCache !== null) {
      if (DEBUG) {
        console.log('[ai-todo-manager] readTodos (from cache):', {
          key,
          count: inMemoryCache.length
        });
      }
      // 返回深拷贝，防止调用者修改缓存
      return JSON.parse(JSON.stringify(inMemoryCache));
    }

    // 从 store 读取
    if (!store) {
      if (DEBUG) console.warn('[ai-todo-manager] readTodos: store not available');
      return [];
    }

    let list = store.get(key);

    if (DEBUG) {
      console.log('[ai-todo-manager] readTodos (from store):', {
        key,
        found: list !== undefined,
        count: Array.isArray(list) ? list.length : 0
      });
    }

    // 确保返回数组（不存在的键返回 undefined）
    list = Array.isArray(list) ? list : [];

    // 缓存到内存（存储原始数据用于后续缓存命中）
    inMemoryCache = JSON.parse(JSON.stringify(list));
    inMemoryCacheKey = key;

    // 返回深拷贝，防止调用者修改缓存
    return JSON.parse(JSON.stringify(inMemoryCache));
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

    // 验证list是数组
    const dataToWrite = Array.isArray(list) ? list : [];

    // 深拷贝数据，防止调用者和缓存共享引用
    const dataCopy = JSON.parse(JSON.stringify(dataToWrite));

    // 写入主键（仅写 session key，实现 session 间的完全隔离）
    // 存储深拷贝，防止 store 存储对缓存的引用
    store.set(key, dataCopy);

    // 更新内存缓存为深拷贝
    inMemoryCache = dataCopy;
    inMemoryCacheKey = key;

    // 注意：不再维护全局 GLOBAL_KEY，因为这会导致 session 间数据污染
    // 如果需要保持兼容性（例如从旧版本升级），可以在迁移时特殊处理
  }

  // 短序号 ID 生成器，对 AI 更友好（如 todo-1, todo-2）
  // 基于 session 内已有 todo 的最大序号递增，避免长随机 ID 导致 AI 记忆困难
  function generateId() {
    const todos = readTodos();
    let maxSeq = 0;
    for (const t of todos) {
      const match = t.id && t.id.match(/^todo-(\d+)$/);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }
    return `todo-${maxSeq + 1}`;
  }

  // 查找待办项：支持多种格式
  // - 精确ID: "todo-1" 或旧版长ID
  // - 序号: "1" → 自动转换为 "todo-1"
  function findTodoById(todoId) {
    const id = String(todoId || '').trim();
    const todos = readTodos();

    // 1. 精确匹配完整 ID（支持新旧格式）
    let found = todos.find(t => t.id === id);
    if (found) return found;

    // 2. 序号匹配：用户/AI 传入 "1" 或 "todo-1" 时匹配 "todo-1"
    const seqMatch = id.match(/^(?:todo-)?(\d+)$/);
    if (seqMatch) {
      found = todos.find(t => t.id === `todo-${seqMatch[1]}`);
      if (found) return found;
    }

    // 3. 旧版长 ID 前缀匹配（兼容历史数据）
    found = todos.find(t => t.id && t.id.startsWith(id));
    if (found) return found;

    return null;
  }

  function normalizePriority(priority) {
    const p = String(priority || 'medium').toLowerCase();
    if (p === 'low' || p === 'high') return p;
    return 'medium';
  }

  function addTodos(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return {
        success: false,
        error: 'Items must be a non-empty array',
        allTodos: readTodos()
      };
    }

    const todos = readTodos();
    const added = [];

    // 计算当前最大序号（一次性，避免重复调用 readTodos）
    let maxSeq = 0;
    for (const t of todos) {
      const match = t.id && t.id.match(/^todo-(\d+)$/);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }

    // 批量添加，使用顺序递增的 ID
    for (const item of items) {
      const text = String(item.title || '').trim();
      if (!text) continue;

      maxSeq++; // 递增序号
      const todo = {
        id: `todo-${maxSeq}`,
        title: text,
        priority: normalizePriority(item.priority),
        completed: false,
        createdAt: Date.now(),
        completedAt: null
      };
      todos.unshift(todo);
      added.push(todo);
    }

    if (added.length === 0) {
      return {
        success: false,
        error: 'All titles are empty',
        allTodos: readTodos()
      };
    }

    writeTodos(todos);
    const updatedTodos = readTodos();
    return {
      success: true,
      added,
      message: `已批量添加 ${added.length} 个待办项（ID: ${added.map(t => t.id).join(', ')}）`,
      allTodos: updatedTodos
    };
  }

  function addTodo(title, priority) {
    const text = String(title || '').trim();
    if (!text) {
      return {
        success: false,
        error: 'Title cannot be empty',
        allTodos: readTodos()
      };
    }

    const todos = readTodos();
    const todo = {
      id: generateId(),
      title: text,
      priority: normalizePriority(priority),
      completed: false,
      createdAt: Date.now(),
      completedAt: null
    };

    // 新的 todo 添加到列表前面
    todos.unshift(todo);
    writeTodos(todos);

    // 返回最新的完整列表（基于内存缓存，确保一致）
    const updatedTodos = readTodos();
    return {
      success: true,
      todo,
      message: `已添加待办项（ID: ${todo.id}）`,
      id: todo.id,
      allTodos: updatedTodos
    };
  }

  function listTodos(filter) {
    const mode = String(filter || 'pending').toLowerCase();
    const todos = readTodos();

    let filtered = todos;
    if (mode === 'pending') {
      filtered = todos.filter(t => !t.completed);
    } else if (mode === 'completed') {
      filtered = todos.filter(t => t.completed);
    }
    // mode === 'all' 时保持原始列表

    const display = filtered
      .map((t, idx) => {
        const mark = t.completed ? '[x]' : '[ ]';
        const pri = t.priority ? `(${t.priority})` : '';
        const num = idx + 1;
        return `${num}. ${mark} ${pri} ${t.title}  (id: ${t.id})`;
      })
      .join('\n');

    return {
      success: true,
      todos: filtered,
      display: display || '暂无待办项',
      count: filtered.length,
      total: todos.length
    };
  }

  function completeTodos(todoIds) {
    if (!Array.isArray(todoIds) || todoIds.length === 0) {
      return {
        success: false,
        error: 'todoIds must be a non-empty array',
        allTodos: readTodos()
      };
    }

    const todos = readTodos();
    const completed = [];
    const notFound = [];

    for (const rawId of todoIds) {
      const id = String(rawId || '').trim();
      if (!id) continue;
      const todo = findTodoById(id);
      if (!todo) {
        notFound.push(id);
        continue;
      }
      const idx = todos.findIndex(t => t.id === todo.id);
      if (!todos[idx].completed) {
        todos[idx] = {
          ...todos[idx],
          completed: true,
          completedAt: Date.now()
        };
        completed.push(todos[idx]);
      }
    }

    writeTodos(todos);
    const updatedTodos = readTodos();

    if (completed.length === 0) {
      return {
        success: false,
        error: notFound.length > 0 ? `未找到待办项: ${notFound.join(', ')}` : '没有可完成的待办项',
        allTodos: updatedTodos
      };
    }

    const notFoundMsg = notFound.length > 0 ? `；未找到: ${notFound.join(', ')}` : '';
    return {
      success: true,
      completed,
      message: `已批量完成 ${completed.length} 个待办项（ID: ${completed.map(t => t.id).join(', ')}）${notFoundMsg}`,
      allTodos: updatedTodos
    };
  }

  function completeTodo(todoId) {
    const id = String(todoId || '').trim();
    if (!id) {
      return {
        success: false,
        error: 'Todo ID cannot be empty',
        allTodos: readTodos()
      };
    }

    const todos = readTodos();
    const todo = findTodoById(id);

    if (!todo) {
      return {
        success: false,
        error: `Todo not found: ${id}`,
        allTodos: todos
      };
    }

    const idx = todos.findIndex(t => t.id === todo.id);
    todos[idx] = {
      ...todos[idx],
      completed: true,
      completedAt: Date.now()
    };
    writeTodos(todos);

    // 返回最新的完整列表
    const updatedTodos = readTodos();
    return {
      success: true,
      todo: todos[idx],
      message: `已完成待办项（ID: ${todo.id}）`,
      allTodos: updatedTodos
    };
  }

  function removeTodo(todoId) {
    const id = String(todoId || '').trim();
    if (!id) {
      return {
        success: false,
        error: 'Todo ID cannot be empty',
        allTodos: readTodos()
      };
    }

    const todos = readTodos();
    const todo = findTodoById(id);

    if (!todo) {
      return {
        success: false,
        error: `Todo not found: ${id}`,
        allTodos: todos
      };
    }

    const next = todos.filter(t => t.id !== todo.id);
    writeTodos(next);

    // 返回最新的完整列表
    const updatedTodos = readTodos();
    return {
      success: true,
      todo,
      message: `已删除待办项（ID: ${todo.id}）`,
      allTodos: updatedTodos
    };
  }

  function editTodo(todoId, updates) {
    const id = String(todoId || '').trim();
    if (!id) {
      return {
        success: false,
        error: 'Todo ID cannot be empty',
        allTodos: readTodos()
      };
    }

    const todos = readTodos();
    const todo = findTodoById(id);

    if (!todo) {
      return {
        success: false,
        error: `Todo not found: ${id}`,
        allTodos: todos
      };
    }

    const idx = todos.findIndex(t => t.id === todo.id);
    const existingTodo = todos[idx];
    const changes = {};

    // 更新标题
    if (updates.title !== undefined) {
      const newTitle = String(updates.title || '').trim();
      if (!newTitle) {
        return {
          success: false,
          error: 'Title cannot be empty',
          allTodos: todos
        };
      }
      changes.title = newTitle;
    }

    // 更新优先级
    if (updates.priority !== undefined) {
      changes.priority = normalizePriority(updates.priority);
    }

    // 更新完成状态
    if (updates.completed !== undefined) {
      const isCompleted = Boolean(updates.completed);
      if (isCompleted && !existingTodo.completed) {
        changes.completed = true;
        changes.completedAt = Date.now();
      } else if (!isCompleted && existingTodo.completed) {
        changes.completed = false;
        changes.completedAt = null;
      }
    }

    if (Object.keys(changes).length === 0) {
      return {
        success: true,
        todo: existingTodo,
        message: '没有要更新的字段',
        allTodos: todos
      };
    }

    todos[idx] = { ...existingTodo, ...changes };
    writeTodos(todos);

    return {
      success: true,
      todo: todos[idx],
      message: `已更新待办项（ID: ${existingTodo.id}）`,
      allTodos: readTodos()
    };
  }

  function getTodoDetails(todoId) {
    const id = String(todoId || '').trim();
    if (!id) {
      return {
        success: false,
        error: 'Todo ID cannot be empty'
      };
    }

    const todo = findTodoById(id);
    if (!todo) {
      return {
        success: false,
        error: `Todo not found: ${id}`
      };
    }

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
      message: `获取待办项详情（ID: ${todo.id}）`
    };
  }

  function buildTodoPrompt() {
    const todos = readTodos();
    const pending = todos.filter(t => !t.completed);
    const completed = todos.filter(t => t.completed);

    const formatLines = list =>
      list
        .map((t, idx) => {
          const mark = t.completed ? '[x]' : '[ ]';
          const pri = t.priority ? `(${t.priority})` : '';
          const num = idx + 1;
          return `${num}. ${mark} ${pri} ${t.title} (id: ${t.id})`;
        })
        .join('\n');

    const pendingText = pending.length ? formatLines(pending) : '- (empty)';
    const completedText = completed.length ? formatLines(completed) : '- (empty)';

    return (
      '\n\n[To Do List - Highest Priority]\n' +
      '以下 To Do 列表为最高优先级指令，必须始终考虑并保持同步。\n' +
      '你可以使用工具 add_todo / add_todos / list_todos / complete_todo / complete_todos / remove_todo 来维护此列表。\n\n' +
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
      return {
        success: false,
        error: 'Store not available'
      };
    }

    const diagnosis = {
      currentKey: getSessionKey(),
      lockedSessionId,
      globalKey: GLOBAL_KEY,
      cacheStatus: {
        key: inMemoryCacheKey,
        size: inMemoryCache ? inMemoryCache.length : 0,
        valid: inMemoryCache !== null
      },
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
    addTodos,
    listTodos,
    completeTodo,
    completeTodos,
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
