/**
 * AI 待办项管理器
 * 负责待办项的 CRUD 业务逻辑
 */

const { createTodoStorage } = require('./ai-todo-storage');

function createAiTodoManager(options) {
  const { store, getActiveSessionId } = options;

  // 创建存储层实例
  const storage = createTodoStorage({ store, getActiveSessionId });

  function addTodos(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return {
        success: false,
        error: 'Items must be a non-empty array',
        allTodos: storage.readTodos()
      };
    }

    const todos = storage.readTodos();
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
        priority: storage.normalizePriority(item.priority),
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
        allTodos: storage.readTodos()
      };
    }

    storage.writeTodos(todos);
    const updatedTodos = storage.readTodos();
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
        allTodos: storage.readTodos()
      };
    }

    const todos = storage.readTodos();
    const todo = {
      id: storage.generateId(),
      title: text,
      priority: storage.normalizePriority(priority),
      completed: false,
      createdAt: Date.now(),
      completedAt: null
    };

    // 新的 todo 添加到列表前面
    todos.unshift(todo);
    storage.writeTodos(todos);

    // 返回最新的完整列表（基于内存缓存，确保一致）
    const updatedTodos = storage.readTodos();
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
    const todos = storage.readTodos();

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
        allTodos: storage.readTodos()
      };
    }

    const todos = storage.readTodos();
    const completed = [];
    const notFound = [];

    for (const rawId of todoIds) {
      const id = String(rawId || '').trim();
      if (!id) continue;
      const todo = storage.findTodoById(id);
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

    storage.writeTodos(todos);
    const updatedTodos = storage.readTodos();

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
        allTodos: storage.readTodos()
      };
    }

    const todos = storage.readTodos();
    const todo = storage.findTodoById(id);

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
    storage.writeTodos(todos);

    const updatedTodos = storage.readTodos();
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
        allTodos: storage.readTodos()
      };
    }

    const todos = storage.readTodos();
    const todo = storage.findTodoById(id);

    if (!todo) {
      return {
        success: false,
        error: `Todo not found: ${id}`,
        allTodos: todos
      };
    }

    const next = todos.filter(t => t.id !== todo.id);
    storage.writeTodos(next);

    const updatedTodos = storage.readTodos();
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
        allTodos: storage.readTodos()
      };
    }

    const todos = storage.readTodos();
    const todo = storage.findTodoById(id);

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
      changes.priority = storage.normalizePriority(updates.priority);
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
    storage.writeTodos(todos);

    return {
      success: true,
      todo: todos[idx],
      message: `已更新待办项（ID: ${existingTodo.id}）`,
      allTodos: storage.readTodos()
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

    const todo = storage.findTodoById(id);
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
    const todos = storage.readTodos();
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
    diagnoseTodos: storage.diagnoseTodos,
    lockSession: storage.lockSession,
    unlockSession: storage.unlockSession,
    readTodos: storage.readTodos,
    writeTodos: storage.writeTodos
  };
}

module.exports = {
  createAiTodoManager
};
