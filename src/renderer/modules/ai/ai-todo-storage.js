/**
 * AI 待办项存储层
 * 负责 session 隔离的存储读写、ID 生成、查找等底层操作
 */

/**
 * 创建待办项存储实例
 * @param {Object} options
 * @param {Object} options.store - 配置存储
 * @param {Function} options.getActiveSessionId - 获取当前活跃会话ID
 */
function createTodoStorage(options) {
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
      console.log('[ai-todo-storage] Session locked:', sessionId);
    }
  }

  function unlockSession() {
    if (DEBUG) {
      console.log('[ai-todo-storage] Session unlocked, was:', lockedSessionId);
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
      console.log('[ai-todo-storage] getSessionKey:', {
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
        console.log('[ai-todo-storage] readTodos (from cache):', {
          key,
          count: inMemoryCache.length
        });
      }
      // 返回深拷贝，防止调用者修改缓存
      return JSON.parse(JSON.stringify(inMemoryCache));
    }

    // 从 store 读取
    if (!store) {
      if (DEBUG) console.warn('[ai-todo-storage] readTodos: store not available');
      return [];
    }

    let list = store.get(key);

    if (DEBUG) {
      console.log('[ai-todo-storage] readTodos (from store):', {
        key,
        found: list !== undefined,
        count: Array.isArray(list) ? list.length : 0
      });
    }

    // 确保返回数组（不存在的键返回 undefined）
    list = Array.isArray(list) ? list : [];

    // 缓存到内存
    inMemoryCache = JSON.parse(JSON.stringify(list));
    inMemoryCacheKey = key;

    // 返回深拷贝
    return JSON.parse(JSON.stringify(inMemoryCache));
  }

  function writeTodos(list) {
    if (!store) {
      if (DEBUG) console.warn('[ai-todo-storage] writeTodos: store not available');
      return;
    }

    const key = getSessionKey();
    if (DEBUG) {
      console.log('[ai-todo-storage] writeTodos:', { key, count: list.length });
    }

    // 验证list是数组
    const dataToWrite = Array.isArray(list) ? list : [];

    // 深拷贝数据，防止调用者和缓存共享引用
    const dataCopy = JSON.parse(JSON.stringify(dataToWrite));

    // 写入主键
    store.set(key, dataCopy);

    // 更新内存缓存为深拷贝
    inMemoryCache = dataCopy;
    inMemoryCacheKey = key;
  }

  // 短序号 ID 生成器，对 AI 更友好（如 todo-1, todo-2）
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
  function findTodoById(todoId) {
    const id = String(todoId || '').trim();
    const todos = readTodos();

    // 1. 精确匹配完整 ID
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
      console.log('[ai-todo-storage] Diagnosis:', diagnosis);
    }

    return {
      success: true,
      diagnosis
    };
  }

  return {
    lockSession,
    unlockSession,
    getSessionKey,
    readTodos,
    writeTodos,
    generateId,
    findTodoById,
    normalizePriority,
    diagnoseTodos
  };
}

module.exports = {
  createTodoStorage
};
