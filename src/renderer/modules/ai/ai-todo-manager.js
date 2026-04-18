function createAiTodoManager(options) {
  const { store, getActiveSessionId } = options;

  const BASE_KEY = 'ai.todoList';

  function getSessionKey() {
    const sessionId = typeof getActiveSessionId === 'function' ? getActiveSessionId() : '';
    return sessionId ? `${BASE_KEY}.${sessionId}` : BASE_KEY;
  }

  function readTodos() {
    const key = getSessionKey();
    const list = store ? store.get(key, []) : [];
    return Array.isArray(list) ? list : [];
  }

  function writeTodos(list) {
    if (!store) return;
    store.set(getSessionKey(), list);
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

  return {
    addTodo,
    listTodos,
    completeTodo,
    removeTodo,
    buildTodoPrompt
  };
}

module.exports = {
  createAiTodoManager
};
