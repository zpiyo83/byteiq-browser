/**
 * Tests for AI Todo Manager - Deep Copy Fix Verification
 * Verifies batch add functionality prevents cache pollution
 */

const { createAiTodoManager } = require('../src/renderer/modules/ai/ai-todo-manager');

// Mock store implementation
class MockStore {
  constructor() {
    this.store = {};
  }

  get(key) {
    return this.store[key];
  }

  set(key, value) {
    this.store[key] = value;
  }

  has(key) {
    return key in this.store;
  }
}

describe('AI Todo Manager - Cache Deep Copy Fix', () => {
  let todoManager;
  let mockStore;

  beforeEach(() => {
    mockStore = new MockStore();
    todoManager = createAiTodoManager({
      store: mockStore,
      getActiveSessionId: () => 'test-session'
    });
  });

  test('addTodo should add a single todo', () => {
    const result = todoManager.addTodo('Test todo', 'medium');
    expect(result.success).toBe(true);
    expect(result.todo).toBeDefined();
    expect(result.todo.title).toBe('Test todo');
    expect(result.todo.priority).toBe('medium');
    expect(result.allTodos).toBeDefined();
    expect(result.allTodos.length).toBe(1);
  });

  test('addTodos should add multiple todos in batch', () => {
    const items = [
      { title: 'Todo 1', priority: 'high' },
      { title: 'Todo 2', priority: 'medium' },
      { title: 'Todo 3', priority: 'low' }
    ];
    const result = todoManager.addTodos(items);
    expect(result.success).toBe(true);
    expect(result.added).toBeDefined();
    expect(result.added.length).toBe(3);
    expect(result.added[0].title).toBe('Todo 1');
    expect(result.added[0].priority).toBe('high');
    expect(result.allTodos.length).toBe(3);
  });

  test('readTodos should return deep copy to prevent cache pollution', () => {
    // Add initial todo
    todoManager.addTodo('Original', 'medium');

    // Read todos (should be deep copy)
    const todos1 = todoManager.readTodos();
    const originalTitle = todos1[0].title;

    // Modify the returned array - should NOT affect cache
    todos1[0].title = 'Modified Title';
    todos1.push({ id: 'fake-todo', title: 'fake', completed: false, priority: 'medium', createdAt: Date.now(), completedAt: null });

    // Read again - should not be affected
    const todos2 = todoManager.readTodos();
    expect(todos2.length).toBe(1);
    expect(todos2[0].title).toBe(originalTitle);
  });

  test('addTodos deep copy prevents modification of cached array', () => {
    // Add initial todo
    todoManager.addTodo('Initial', 'medium');

    // Batch add
    const result = todoManager.addTodos([
      { title: 'Task 1', priority: 'high' },
      { title: 'Task 2', priority: 'low' }
    ]);

    // Verify result is correct
    expect(result.success).toBe(true);
    expect(result.allTodos.length).toBe(3);

    // Modify the returned allTodos array
    const returnedTodos = result.allTodos;
    returnedTodos[0].title = 'Corrupted Title';
    returnedTodos.splice(0, 1);

    // Read again - should not be affected
    const stored = todoManager.readTodos();
    expect(stored.length).toBe(3);
    expect(stored[0].title).not.toBe('Corrupted Title');
  });

  test('completeTodo should mark completed correctly', () => {
    const addResult = todoManager.addTodo('Test todo', 'medium');
    const todoId = addResult.id;

    const result = todoManager.completeTodo(todoId);
    expect(result.success).toBe(true);
    expect(result.todo.completed).toBe(true);
    expect(result.allTodos[0].completed).toBe(true);
  });

  test('completeTodos should mark multiple todos as completed', () => {
    const todo1 = todoManager.addTodo('Test 1', 'medium').id;
    const todo2 = todoManager.addTodo('Test 2', 'high').id;
    const todo3 = todoManager.addTodo('Test 3', 'low').id;

    const result = todoManager.completeTodos([todo1, todo2]);
    expect(result.success).toBe(true);
    expect(result.completed.length).toBe(2);

    // Verify state - allTodos should be updated
    const todos = todoManager.readTodos();
    const completed = todos.filter(t => t.completed);
    expect(completed.length).toBe(2);
  });

  test('removeTodo should delete a todo', () => {
    const addResult = todoManager.addTodo('Test todo', 'medium');
    const todoId = addResult.id;

    let listResult = todoManager.listTodos();
    expect(listResult.todos.length).toBe(1);

    const removeResult = todoManager.removeTodo(todoId);
    expect(removeResult.success).toBe(true);

    listResult = todoManager.listTodos();
    expect(listResult.todos.length).toBe(0);
  });

  test('Batch operations should maintain data integrity', () => {
    // Add batch of todos
    const items = [
      { title: 'Task 1', priority: 'high' },
      { title: 'Task 2', priority: 'medium' },
      { title: 'Task 3', priority: 'low' }
    ];
    const addResult = todoManager.addTodos(items);
    const todoIds = addResult.added.map(t => t.id);

    // Complete two of them
    const completeResult = todoManager.completeTodos([todoIds[0], todoIds[1]]);
    expect(completeResult.success).toBe(true);
    expect(completeResult.completed.length).toBe(2);

    // List and verify
    const listResult = todoManager.listTodos('all');
    const completed = listResult.todos.filter(t => t.completed);
    const pending = listResult.todos.filter(t => !t.completed);

    expect(completed.length).toBe(2);
    expect(pending.length).toBe(1);

    // Remove one
    todoManager.removeTodo(todoIds[0]);

    const finalResult = todoManager.listTodos('all');
    expect(finalResult.todos.length).toBe(2);
  });

  test('Session locking should maintain separate todo lists', () => {
    // Add todos for session 1
    const mgr1 = createAiTodoManager({
      store: mockStore,
      getActiveSessionId: () => 'session-1'
    });
    mgr1.addTodo('Session 1 - Todo 1', 'medium');
    mgr1.addTodo('Session 1 - Todo 2', 'high');

    // Create manager for session 2
    const mgr2 = createAiTodoManager({
      store: mockStore,
      getActiveSessionId: () => 'session-2'
    });
    mgr2.addTodo('Session 2 - Todo 1', 'medium');

    // Verify session 1 has 2 todos
    const s1List = mgr1.listTodos('all');
    expect(s1List.todos.length).toBe(2);

    // Verify session 2 has 1 todo
    const s2List = mgr2.listTodos('all');
    expect(s2List.todos.length).toBe(1);
    expect(s2List.todos[0].title).toBe('Session 2 - Todo 1');
  });

  test('Multiple sequential batch adds should increment IDs correctly', () => {
    const batch1 = todoManager.addTodos([
      { title: 'Batch 1 - Task 1' },
      { title: 'Batch 1 - Task 2' }
    ]);

    const batch2 = todoManager.addTodos([
      { title: 'Batch 2 - Task 1' },
      { title: 'Batch 2 - Task 2' }
    ]);

    expect(batch1.added.length).toBe(2);
    expect(batch2.added.length).toBe(2);

    const todos = todoManager.readTodos();
    expect(todos.length).toBe(4);

    // Verify IDs are unique and sequential
    const ids = todos.map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(4);

    // Verify ID format (should be todo-N)
    ids.forEach(id => {
      expect(id).toMatch(/^todo-\d+$/);
    });
  });

  test('writeTodos should store deep copy preventing reference pollution', () => {
    const todos = [
      { id: 'todo-1', title: 'Task 1', completed: false, priority: 'high', createdAt: Date.now(), completedAt: null },
      { id: 'todo-2', title: 'Task 2', completed: false, priority: 'medium', createdAt: Date.now(), completedAt: null }
    ];

    todoManager.writeTodos(todos);

    // Modify original array after writing
    todos[0].title = 'Corrupted Title';
    todos.push({ id: 'fake-todo', title: 'Fake' });

    // Read stored data - should not be affected
    const stored = todoManager.readTodos();
    expect(stored.length).toBe(2);
    expect(stored[0].title).toBe('Task 1');
    expect(stored.some(t => t.id === 'fake-todo')).toBe(false);
  });
});
