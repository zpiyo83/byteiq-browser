/**
 * AI 会话与存储服务
 */

function createAiSessionService(options) {
  const { historyStorage, store, t, getActiveTabId } = options;

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
    return session.id;
  }

  async function getCurrentSession() {
    const tabId = getActiveTabId();
    if (!tabId) {
      const activeId = getActiveSessionId();
      if (activeId) {
        await ensureSessionExists(activeId);
        return getSessionById(activeId);
      }
      const session = await createSession();
      setActiveSessionId(session.id);
      return session;
    }

    const sessionId = await getOrCreateSessionIdForTab(tabId);
    setActiveSessionId(sessionId);
    return getSessionById(sessionId);
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
    getSortedSessions,
    unbindSessionFromTab,
    bindSessionToCurrentTab,
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
