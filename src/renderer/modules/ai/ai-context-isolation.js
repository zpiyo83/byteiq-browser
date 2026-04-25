/**
 * AI 上下文隔离管理器
 * 确保每个对话会话的上下文完全隔离，切换会话时清理所有相关状态
 *
 * 核心功能：
 * 1. 会话切换生命周期钩子 - 切换前后执行清理和初始化
 * 2. 会话绑定操作守卫 - 防止异步操作写入错误的会话
 * 3. 内存缓存失效 - 会话切换时自动清理缓存
 * 4. 会话身份验证 - 异步操作写入前校验会话归属
 */

function createAiContextIsolation(options = {}) {
  const { getLogger } = options;

  // 当前活跃会话ID，用于快速校验
  let activeSessionId = null;

  // 会话切换前的清理回调列表
  const beforeSwitchHooks = [];
  // 会话切换后的初始化回调列表
  const afterSwitchHooks = [];

  // 需要在会话切换时失效的缓存注册表
  // 键: 缓存标识名, 值: { invalidate: Function, description: string }
  const cacheRegistry = new Map();

  // 活跃的异步操作映射
  // 键: operationId, 值: { sessionId, type, startedAt }
  const activeOperations = new Map();
  let operationCounter = 0;

  function log(level, message, data) {
    if (typeof getLogger === 'function') {
      const logger = getLogger(level);
      if (logger) {
        logger(`[ai-context-isolation] ${message}`, data || '');
      }
    } else if (level === 'warn' || level === 'error') {
      console[level](`[ai-context-isolation] ${message}`, data || '');
    }
  }

  /**
   * 注册会话切换前的清理钩子
   * @param {Function} hook - 清理函数，接收 (fromSessionId, toSessionId) 参数
   * @returns {Function} 取消注册的函数
   */
  function onBeforeSwitch(hook) {
    if (typeof hook !== 'function') {
      log('warn', 'onBeforeSwitch: hook 必须是函数');
      return () => {};
    }
    beforeSwitchHooks.push(hook);
    return () => {
      const idx = beforeSwitchHooks.indexOf(hook);
      if (idx !== -1) beforeSwitchHooks.splice(idx, 1);
    };
  }

  /**
   * 注册会话切换后的初始化钩子
   * @param {Function} hook - 初始化函数，接收 (toSessionId, fromSessionId) 参数
   * @returns {Function} 取消注册的函数
   */
  function onAfterSwitch(hook) {
    if (typeof hook !== 'function') {
      log('warn', 'onAfterSwitch: hook 必须是函数');
      return () => {};
    }
    afterSwitchHooks.push(hook);
    return () => {
      const idx = afterSwitchHooks.indexOf(hook);
      if (idx !== -1) afterSwitchHooks.splice(idx, 1);
    };
  }

  /**
   * 注册需要在会话切换时失效的缓存
   * @param {string} cacheName - 缓存标识名
   * @param {Function} invalidateFn - 失效函数
   * @param {string} description - 缓存描述
   * @returns {Function} 取消注册的函数
   */
  function registerCache(cacheName, invalidateFn, description = '') {
    if (typeof invalidateFn !== 'function') {
      log('warn', `registerCache: ${cacheName} 的 invalidate 必须是函数`);
      return () => {};
    }
    cacheRegistry.set(cacheName, {
      invalidate: invalidateFn,
      description: description || cacheName
    });
    return () => cacheRegistry.delete(cacheName);
  }

  /**
   * 注册一个会话绑定的异步操作
   * @param {string} type - 操作类型（如 'streaming', 'agent-loop', 'page-extract'）
   * @returns {{ operationId: string, guard: Function, dispose: Function }}
   *   - operationId: 操作唯一标识
   *   - guard: 守卫函数，调用返回 true 表示操作仍属于当前会话
   *   - dispose: 手动清理操作注册
   */
  function registerOperation(type) {
    const opId = `op-${++operationCounter}-${Date.now()}`;
    const sessionId = activeSessionId;
    activeOperations.set(opId, {
      sessionId,
      type: type || 'unknown',
      startedAt: Date.now()
    });

    log('info', `注册操作: ${opId}, type=${type}, sessionId=${sessionId}`);

    return {
      operationId: opId,
      /**
       * 守卫函数：检查操作是否仍属于当前活跃会话
       * @returns {boolean} true 表示安全，false 表示会话已切换，应中止操作
       */
      guard() {
        const op = activeOperations.get(opId);
        if (!op) return false; // 操作已被清理
        return op.sessionId === activeSessionId;
      },
      /**
       * 获取操作绑定的会话ID
       * @returns {string|null}
       */
      getBoundSessionId() {
        const op = activeOperations.get(opId);
        return op ? op.sessionId : null;
      },
      /**
       * 手动清理操作注册
       */
      dispose() {
        activeOperations.delete(opId);
      }
    };
  }

  /**
   * 校验指定会话ID是否与当前活跃会话一致
   * @param {string} sessionId - 待校验的会话ID
   * @returns {boolean} true 表示匹配，false 表示会话已切换
   */
  function isSessionActive(sessionId) {
    return sessionId === activeSessionId;
  }

  /**
   * 执行会话切换
   * 这是核心方法，当用户切换对话时必须调用
   *
   * @param {string} toSessionId - 目标会话ID
   * @returns {Promise<void>}
   */
  async function switchSession(toSessionId) {
    if (!toSessionId) {
      log('warn', 'switchSession: toSessionId 不能为空');
      return;
    }

    const fromSessionId = activeSessionId;

    // 如果是同一个会话，跳过
    if (fromSessionId === toSessionId) {
      return;
    }

    log('info', `会话切换: ${fromSessionId} → ${toSessionId}`);

    // 阶段1：执行 beforeSwitch 钩子（清理旧会话状态）
    for (const hook of beforeSwitchHooks) {
      try {
        await hook(fromSessionId, toSessionId);
      } catch (err) {
        log('error', 'beforeSwitch 钩子执行失败:', err);
      }
    }

    // 阶段2：失效所有注册的缓存
    for (const [name, cache] of cacheRegistry) {
      try {
        cache.invalidate();
        log('info', `缓存已失效: ${name} (${cache.description})`);
      } catch (err) {
        log('error', `缓存失效失败: ${name}`, err);
      }
    }

    // 阶段3：取消所有属于旧会话的异步操作
    const opsToCancel = [];
    for (const [opId, op] of activeOperations) {
      if (op.sessionId === fromSessionId) {
        opsToCancel.push({ opId, ...op });
      }
    }
    // 注意：不直接删除操作，而是让操作的 guard() 返回 false
    // 操作自身会在下次检查时发现 guard 返回 false 而自行中止
    // 但我们仍需标记这些操作为已取消
    for (const op of opsToCancel) {
      activeOperations.delete(op.opId);
      log('info', `已取消操作: ${op.opId}, type=${op.type}`);
    }

    // 阶段4：更新活跃会话ID
    activeSessionId = toSessionId;

    // 阶段5：执行 afterSwitch 钩子（初始化新会话状态）
    for (const hook of afterSwitchHooks) {
      try {
        await hook(toSessionId, fromSessionId);
      } catch (err) {
        log('error', 'afterSwitch 钩子执行失败:', err);
      }
    }
  }

  /**
   * 设置初始活跃会话ID（不触发钩子）
   * @param {string} sessionId
   */
  function setActiveSession(sessionId) {
    activeSessionId = sessionId;
  }

  /**
   * 获取当前活跃会话ID
   * @returns {string|null}
   */
  function getActiveSessionId() {
    return activeSessionId;
  }

  /**
   * 获取当前活跃的异步操作数量
   * @returns {number}
   */
  function getActiveOperationCount() {
    return activeOperations.size;
  }

  /**
   * 获取诊断信息（用于调试）
   */
  function diagnose() {
    const operations = [];
    for (const [opId, op] of activeOperations) {
      operations.push({
        id: opId,
        sessionId: op.sessionId,
        type: op.type,
        age: Date.now() - op.startedAt
      });
    }

    const caches = [];
    for (const [name, cache] of cacheRegistry) {
      caches.push({ name, description: cache.description });
    }

    return {
      activeSessionId,
      operationCount: activeOperations.size,
      operations,
      cacheCount: cacheRegistry.size,
      caches,
      beforeSwitchHookCount: beforeSwitchHooks.length,
      afterSwitchHookCount: afterSwitchHooks.length
    };
  }

  /**
   * 重置所有状态（用于测试）
   */
  function reset() {
    activeSessionId = null;
    beforeSwitchHooks.length = 0;
    afterSwitchHooks.length = 0;
    cacheRegistry.clear();
    activeOperations.clear();
    operationCounter = 0;
  }

  return {
    // 生命周期钩子
    onBeforeSwitch,
    onAfterSwitch,
    // 缓存注册
    registerCache,
    // 操作守卫
    registerOperation,
    // 会话校验
    isSessionActive,
    // 会话切换
    switchSession,
    setActiveSession,
    getActiveSessionId,
    // 诊断
    getActiveOperationCount,
    diagnose,
    reset
  };
}

module.exports = {
  createAiContextIsolation
};
