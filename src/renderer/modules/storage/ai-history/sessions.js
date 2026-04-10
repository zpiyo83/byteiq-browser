const { STORES } = require('./schema');

async function createSession(storage, sessionData) {
  await storage.init();
  const session = {
    id: sessionData.id || storage.generateId(),
    title: sessionData.title || '新会话',
    pinned: sessionData.pinned || false,
    deleted: sessionData.deleted || false,
    mode: sessionData.mode || 'qa',
    createdAt: sessionData.createdAt || Date.now(),
    updatedAt: sessionData.updatedAt || Date.now(),
    messageCount: 0,
    pageContext: sessionData.pageContext || null
  };

  return new Promise((resolve, reject) => {
    const tx = storage.getTransaction([STORES.sessions], 'readwrite');
    const store = tx.objectStore(STORES.sessions);
    const request = store.add(session);

    request.onsuccess = () => resolve(session);
    request.onerror = () => reject(request.error);
  });
}

async function getSession(storage, sessionId) {
  await storage.init();
  return new Promise((resolve, reject) => {
    const tx = storage.getTransaction([STORES.sessions]);
    const store = tx.objectStore(STORES.sessions);
    const request = store.get(sessionId);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function updateSession(storage, sessionId, patch) {
  await storage.init();
  const session = await storage.getSession(sessionId);
  if (!session) return null;

  const updated = {
    ...session,
    ...patch,
    updatedAt: Date.now()
  };

  return new Promise((resolve, reject) => {
    const tx = storage.getTransaction([STORES.sessions], 'readwrite');
    const store = tx.objectStore(STORES.sessions);
    const request = store.put(updated);

    request.onsuccess = () => resolve(updated);
    request.onerror = () => reject(request.error);
  });
}

async function deleteSession(storage, sessionId) {
  return storage.updateSession(sessionId, { deleted: true });
}

async function permanentlyDeleteSession(storage, sessionId) {
  await storage.init();
  const tx = storage.getTransaction(
    [STORES.sessions, STORES.messages, STORES.searchIndex],
    'readwrite'
  );

  tx.objectStore(STORES.sessions).delete(sessionId);

  const msgStore = tx.objectStore(STORES.messages);
  const msgIndex = msgStore.index('sessionId');
  const msgRequest = msgIndex.openCursor(sessionId);

  msgRequest.onsuccess = event => {
    const cursor = event.target.result;
    if (cursor) {
      msgStore.delete(cursor.value.id);
      cursor.continue();
    }
  };

  const searchStore = tx.objectStore(STORES.searchIndex);
  const searchIndex = searchStore.index('sessionId');
  const searchRequest = searchIndex.openCursor(sessionId);

  searchRequest.onsuccess = event => {
    const cursor = event.target.result;
    if (cursor) {
      searchStore.delete(cursor.value.id);
      cursor.continue();
    }
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function getSessions(storage, options = {}) {
  await storage.init();
  const { includeDeleted = false, limit = 100, offset = 0, sortBy = 'updatedAt' } = options;

  return new Promise((resolve, reject) => {
    const tx = storage.getTransaction([STORES.sessions]);
    const store = tx.objectStore(STORES.sessions);
    const index = store.index(sortBy);

    const sessions = [];
    let skipped = 0;
    let count = 0;

    const request = index.openCursor(null, 'prev');

    request.onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve(sessions);
        return;
      }

      const session = cursor.value;

      if (!includeDeleted && session.deleted) {
        cursor.continue();
        return;
      }

      if (skipped < offset) {
        skipped++;
        cursor.continue();
        return;
      }

      if (count < limit) {
        sessions.push(session);
        count++;
        cursor.continue();
      } else {
        resolve(sessions);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

async function countSessions(storage, includeDeleted = false) {
  await storage.init();
  return new Promise((resolve, reject) => {
    const tx = storage.getTransaction([STORES.sessions]);
    const store = tx.objectStore(STORES.sessions);
    const request = store.count();
    request.onsuccess = () => {
      if (includeDeleted) {
        resolve(request.result);
        return;
      }
      // 排除已删除的：用 deleted 索引计数
      const delIndex = store.index('deleted');
      const delReq = delIndex.count(true);
      delReq.onsuccess = () => resolve(request.result - delReq.result);
      delReq.onerror = () => resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

module.exports = {
  countSessions,
  createSession,
  deleteSession,
  getSession,
  getSessions,
  permanentlyDeleteSession,
  updateSession
};
