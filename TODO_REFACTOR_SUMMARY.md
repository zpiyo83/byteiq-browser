# Todo 功能重构总结

## 问题分析

### 原始缺陷
1. **存储键管理混乱**：`writeTodos()` 同时维护两个键（session key 和 global key），导致数据同步不一致
2. **Session 间数据污染**：切换 session 时仍然读取其他 session 的数据，通过 global key fallback 机制
3. **列表显示缺失**：`listTodos()` 返回的结果不包含完整的待办列表，导致 AI 无法在工具调用后立即看到更新
4. **缓存机制缺失**：每次操作都重新读写存储，没有内存缓存优化

### 症状
- 添加待办项后，`list_todos` 无法显示新项
- AI 调用 `complete_todo` 后无法看到更新的列表
- Session 切换导致待办项混乱

## 解决方案

### 1. 内存缓存机制 ✅
```javascript
let inMemoryCache = null;
let inMemoryCacheKey = null;
```
- 缓存当前 session 的待办列表
- 减少存储读写频率
- Session 切换或锁定时自动清空缓存

### 2. Session 完全隔离 ✅
- 移除 `writeTodos()` 中的全局 key 同步逻辑
- 每个 session 拥有完全独立的存储空间
- 只有在完全没有 session ID 时才使用全局 key 作为 fallback

### 3. 统一返回值格式 ✅
所有操作都返回 `allTodos`（完整列表）：
```javascript
{
  success: true,
  todo: {...},          // 单个操作的对象
  allTodos: [...],      // 完整的待办列表
  message: '...'
}
```

AI Tools Registry 在此基础上生成 `currentList` 供显示：
```javascript
currentList = allTodos
  .map((t, idx) => `${idx+1}. ${mark} ${pri} ${t.title} (id: ${t.id})`)
  .join('\n')
```

### 4. Session 锁定机制 ✅
Agent 运行期间锁定 session，防止标签页切换导致的 context 丢失：
```javascript
todoManager.lockSession(session.id);  // Agent 开始时
// ... AI 操作 ...
todoManager.unlockSession();          // Agent 结束时
```

## 核心改进

| 方面 | 原来 | 现在 |
|------|------|------|
| 存储模式 | 双键同步（混乱） | 单键隔离（清晰） |
| 缓存 | 无 | 内存缓存 + 键绑定 |
| Session 隔离 | 不完全（全局 fallback） | 完全隔离 |
| 返回值 | 部分操作缺 allTodos | 统一包含 allTodos |
| 工具集成 | 工具需额外调用 listTodos | 工具直接显示完整列表 |

## 测试覆盖

✅ **单元测试** (`test-todo-refactor.js`)
- Basic Add and List
- Session Lock and Cache
- Complete and Remove
- Diagnosis

✅ **集成测试** (`test-ai-tools-todo.js`)
- add_todo tool
- list_todos tool
- complete_todo tool
- remove_todo tool
- allTodos 返回值验证

✅ **场景测试**
- Session 锁定期间切换 session
- Session 解锁后恢复访问
- 跨 session 数据隔离

## 使用示例

```javascript
// 创建 Todo Manager
const todoManager = createAiTodoManager({
  store,
  getActiveSessionId: () => currentSessionId
});

// Agent 运行期间锁定 session
todoManager.lockSession(session.id);

// 添加待办项
const addResult = todoManager.addTodo('完成文档', 'high');
// {
//   success: true,
//   todo: { id: 'todo-1', title: '完成文档', ... },
//   allTodos: [{ id: 'todo-1', ... }],
//   message: '已添加待办项（ID: todo-1）'
// }

// 列出待办项
const listResult = todoManager.listTodos('pending');
// {
//   success: true,
//   todos: [{ id: 'todo-1', ... }],
//   display: '1. [ ] (high) 完成文档  (id: todo-1)',
//   count: 1,
//   total: 1
// }

// 完成待办项
const completeResult = todoManager.completeTodo('todo-1');
// {
//   success: true,
//   todo: { id: 'todo-1', completed: true, ... },
//   allTodos: [{ id: 'todo-1', completed: true, ... }],
//   message: '已完成待办项（ID: todo-1）'
// }

// 解锁 session（Agent 结束时）
todoManager.unlockSession();
```

## API 接口

### 方法

```javascript
// 管理方法
lockSession(sessionId)           // 锁定 session，防止切换
unlockSession()                  // 解锁 session

readTodos()                      // 读取当前 session 的所有待办项
writeTodos(list)                 // 写入待办项列表

// 业务方法
addTodo(title, priority?)        // 添加待办项
listTodos(filter?)               // 列出待办项 (all/pending/completed)
completeTodo(todoId)             // 标记完成
removeTodo(todoId)               // 删除待办项
editTodo(todoId, updates)        // 编辑待办项

// 查询方法
getTodoDetails(todoId)           // 获取单个待办项详情
buildTodoPrompt()                // 为系统提示词构建待办列表

// 诊断方法
diagnoseTodos()                  // 诊断存储状态（调试用）
```

### 返回值格式

所有返回值都包含 `success` 标志和相应的数据：

```typescript
interface AddTodoResult {
  success: true;
  todo: Todo;
  allTodos: Todo[];
  message: string;
  id: string;
}

interface ListTodosResult {
  success: true;
  todos: Todo[];
  display: string;
  count: number;
  total: number;
}

interface CompleteTodoResult {
  success: true;
  todo: Todo;
  allTodos: Todo[];
  message: string;
}
```

## 性能优化

1. **内存缓存**：避免频繁的 store 读写
2. **键绑定验证**：缓存与键绑定，session 变更时自动清空
3. **批量写入**：单次 writeTodos 完成所有修改

## 向后兼容性

- 支持旧版长 ID 格式识别
- 序号匹配（`"1"` → `"todo-1"`）
- 前缀匹配作为最后的降级方案

## 已知限制

- Global key fallback 仅在完全无 session ID 时启用
- 内存缓存与当前 session key 绑定
- 不支持跨进程的 todo 同步（可在需要时扩展）
