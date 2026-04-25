/**
 * AI 会话与存储服务
 */

function createAiSessionService(options) {
  const { historyStorage, store, t, getActiveTabId, contextIsolation } = options;

  let storageInitialized = false;

  const STORE_KEYS = {
    tabToSession: 'ai.tabToSession',
    activeSessionId: 'ai.activeSessionId'
  };

  async function initStorage() {
    if (storageInitialized) return;
    try {
      await historyStorage.init();
      storageInitialized = true;
    } catch (error) {
      console.error('Failed to initialize AI history storage:', error);
    }
  }

  function readTabToSessionFromStore() {
    return store?.get(STORE_KEYS.tabToSession, {}) || {};
  }

  function writeTabToSessionToStore(nextMap) {
    if (!store) return;
    store.set(STORE_KEYS.tabToSession, nextMap);
  }

  function getActiveSessionId() {
    return store?.get(STORE_KEYS.activeSessionId, '') || '';
  }

  function setActiveSessionId(sessionId) {
    if (!store) return;
    store.set(STORE_KEYS.activeSessionId, sessionId);
    // 同步到上下文隔离管理器
    if (contextIsolation && typeof contextIsolation.setActiveSession === 'function') {
      contextIsolation.setActiveSession(sessionId);
    }
  }

  async function ensureSessionExists(sessionId) {
    await initStorage();
    const session = await historyStorage.getSession(sessionId);
    if (session) return session;

    const newSession = await historyStorage.createSession({
      id: sessionId,
      title: t('ai.sessionUntitled') || '新会话',
      pinned: false,
      deleted: false,
      mode: 'qa',
      pageContext: null
    });
    return newSession;
  }

  async function createSession({ title, mode } = {}) {
    await initStorage();
    return historyStorage.createSession({
      title: title || t('ai.sessionUntitled') || '新会话',
      pinned: false,
      deleted: false,
      mode: mode || 'qa',
      pageContext: null
    });
  }

  async function getSessionById(sessionId) {
    await initStorage();
    return historyStorage.getSession(sessionId);
  }

  async function updateSession(sessionId, patch) {
    await initStorage();
    return historyStorage.updateSession(sessionId, patch);
  }

  async function getOrCreateSessionIdForTab(tabId) {
    const tabToSession = readTabToSessionFromStore();
    if (tabToSession[tabId]) {
      await ensureSessionExists(tabToSession[tabId]);
      return tabToSession[tabId];
    }

    const session = await createSession({ title: t('ai.sessionForTab') || '当前标签页' });
    tabToSession[tabId] = session.id;
    writeTabToSessionToStore(tabToSession);
    // 触发上下文隔离生命周期
    if (contextIsolation && typeof contextIsolation.switchSession === 'function') {
      contextIsolation.switchSession(session.id);
    }
    return session.id;
  }

  async function getCurrentSession() {
    const tabId = getActiveTabId();
    let sessionId;

    if (!tabId) {
      const activeId = getActiveSessionId();
      if (activeId) {
        await ensureSessionExists(activeId);
        sessionId = activeId;
      } else {
        const session = await createSession();
        setActiveSessionId(session.id);
        sessionId = session.id;
      }
    } else {
      sessionId = await getOrCreateSessionIdForTab(tabId);
      setActiveSessionId(sessionId);
    }

    // 检测会话是否变更，触发上下文隔离切换
    const currentContextSessionId =
      contextIsolation && typeof contextIsolation.getActiveSessionId === 'function'
        ? contextIsolation.getActiveSessionId()
        : null;
    if (currentContextSessionId !== sessionId) {
      if (contextIsolation && typeof contextIsolation.switchSession === 'function') {
        contextIsolation.switchSession(sessionId);
      }
    }

    return getSessionById(sessionId);
  }

  /**
   * 切换到指定会话（手动切换）
   * 同时更新存储和上下文隔离状态
   */
  async function switchToSession(sessionId) {
    if (!sessionId) return;
    await ensureSessionExists(sessionId);
    setActiveSessionId(sessionId);
    // 绑定到当前标签页（如果存在）
    const tabId = getActiveTabId();
    if (tabId) {
      bindTabToSession(tabId, sessionId);
    }
    // 触发上下文隔离切换
    if (contextIsolation && typeof contextIsolation.switchSession === 'function') {
      contextIsolation.switchSession(sessionId);
    }
  }

  async function getSortedSessions() {
    await initStorage();
    const sessions = await historyStorage.getSessions({ includeDeleted: true, limit: 1000 });
    // 附加最后一条消息预览
    for (const session of sessions) {
      try {
        const lastMsg = await historyStorage.getLastMessage(session.id);
        if (lastMsg) {
          session.lastMessage = lastMsg.content;
        }
      } catch {
        // 获取失败不影响列表
      }
    }
    sessions.sort((a, b) => {
      // 已删除的排到最后
      if (!!a.deleted !== !!b.deleted) return a.deleted ? 1 : -1;
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return sessions;
  }

  function unbindSessionFromTab(tabId, sessionId) {
    if (!tabId) return;
    const tabToSession = readTabToSessionFromStore();
    if (tabToSession[tabId] === sessionId) {
      delete tabToSession[tabId];
      writeTabToSessionToStore(tabToSession);
    }
  }

  function unbindSessionFromAllTabs(sessionId) {
    if (!sessionId) return;
    const tabToSession = readTabToSessionFromStore();
    let changed = false;
    Object.keys(tabToSession).forEach(tabId => {
      if (tabToSession[tabId] === sessionId) {
        delete tabToSession[tabId];
        changed = true;
      }
    });
    if (changed) {
      writeTabToSessionToStore(tabToSession);
    }
  }

  function bindSessionToCurrentTab(sessionId) {
    const tabId = getActiveTabId();
    if (!tabId) return;
    const tabToSession = readTabToSessionFromStore();
    tabToSession[tabId] = sessionId;
    writeTabToSessionToStore(tabToSession);
  }

  // 强制绑定特定的tabId到特定的sessionId
  // 用于Agent工具创建新标签页时，确保新标签页属于当前Agent的会话
  function bindTabToSession(tabId, sessionId) {
    if (!tabId || !sessionId) return;
    const tabToSession = readTabToSessionFromStore();
    tabToSession[tabId] = sessionId;
    writeTabToSessionToStore(tabToSession);
  }

  function clearTabConversation(tabId) {
    if (!tabId || !store) return;
    const tabToSession = readTabToSessionFromStore();
    delete tabToSession[tabId];
    writeTabToSessionToStore(tabToSession);
  }

  return {
    initStorage,
    ensureSessionExists,
    createSession,
    getSessionById,
    updateSession,
    getOrCreateSessionIdForTab,
    getCurrentSession,
    switchToSession,
    getSortedSessions,
    unbindSessionFromTab,
    bindSessionToCurrentTab,
    bindTabToSession,
    clearTabConversation,
    readTabToSessionFromStore,
    writeTabToSessionToStore,
    getActiveSessionId,
    setActiveSessionId,
    unbindSessionFromAllTabs
  };
}

module.exports = {
  createAiSessionService
};
