const { STORES } = require('./schema');

async function addMessage(storage, sessionId, message) {
  await storage.init();
  const msg = {
    id: storage.generateId(),
    sessionId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt || Date.now(),
    metadata: message.metadata || {}
  };

  const tx = storage.getTransaction(
    [STORES.messages, STORES.sessions, STORES.searchIndex],
    'readwrite'
  );

  const msgStore = tx.objectStore(STORES.messages);
  msgStore.add(msg);

  const sessionStore = tx.objectStore(STORES.sessions);
  const sessionRequest = sessionStore.get(sessionId);
  sessionRequest.onsuccess = () => {
    const session = sessionRequest.result;
    if (session) {
      session.messageCount = (session.messageCount || 0) + 1;
      session.updatedAt = Date.now();
      sessionStore.put(session);
    }
  };

  const searchStore = tx.objectStore(STORES.searchIndex);
  searchStore.add({
    id: storage.generateId(),
    sessionId,
    messageId: msg.id,
    text: message.content.toLowerCase(),
    createdAt: msg.createdAt
  });

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(msg);
    tx.onerror = () => reject(tx.error);
  });
}

async function getMessages(storage, sessionId, options = {}) {
  await storage.init();
  const { limit = 50, offset = 0 } = options;

  return new Promise((resolve, reject) => {
    const tx = storage.getTransaction([STORES.messages]);
    const store = tx.objectStore(STORES.messages);
    const index = store.index('sessionId');

    const messages = [];
    let skipped = 0;
    let count = 0;

    const request = index.openCursor(sessionId);

    request.onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) {
        resolve(messages);
        return;
      }

      if (skipped < offset) {
        skipped++;
        cursor.continue();
        return;
      }

      if (count < limit) {
        messages.push(cursor.value);
        count++;
        cursor.continue();
      } else {
        resolve(messages);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

async function countMessages(storage, sessionId) {
  await storage.init();
  return new Promise((resolve, reject) => {
    const tx = storage.getTransaction([STORES.messages]);
    const store = tx.objectStore(STORES.messages);
    const index = store.index('sessionId');
    const request = index.count(sessionId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * 获取会话的最后一条消息（用于预览）
 */
async function getLastMessage(storage, sessionId) {
  await storage.init();
  return new Promise((resolve, reject) => {
    const tx = storage.getTransaction([STORES.messages]);
    const store = tx.objectStore(STORES.messages);
    const index = store.index('sessionId');
    const request = index.openCursor(sessionId, 'prev');
    request.onsuccess = event => {
      const cursor = event.target.result;
      resolve(cursor ? cursor.value : null);
    };
    request.onerror = () => reject(request.error);
  });
}

module.exports = {
  addMessage,
  countMessages,
  getLastMessage,
  getMessages
};
