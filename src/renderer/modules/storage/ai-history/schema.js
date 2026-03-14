const DB_NAME = 'ByteIQ_AI_History';
const DB_VERSION = 1;

const STORES = {
  sessions: 'sessions',
  messages: 'messages',
  searchIndex: 'searchIndex'
};

function upgradeDatabase(db) {
  if (!db.objectStoreNames.contains(STORES.sessions)) {
    const sessionStore = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
    sessionStore.createIndex('updatedAt', 'updatedAt', { unique: false });
    sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
    sessionStore.createIndex('deleted', 'deleted', { unique: false });
    sessionStore.createIndex('pinned', 'pinned', { unique: false });
  }

  if (!db.objectStoreNames.contains(STORES.messages)) {
    const msgStore = db.createObjectStore(STORES.messages, { keyPath: 'id' });
    msgStore.createIndex('sessionId', 'sessionId', { unique: false });
    msgStore.createIndex('createdAt', 'createdAt', { unique: false });
    msgStore.createIndex('role', 'role', { unique: false });
  }

  if (!db.objectStoreNames.contains(STORES.searchIndex)) {
    const searchStore = db.createObjectStore(STORES.searchIndex, { keyPath: 'id' });
    searchStore.createIndex('sessionId', 'sessionId', { unique: false });
    searchStore.createIndex('text', 'text', { unique: false });
  }
}

module.exports = {
  DB_NAME,
  DB_VERSION,
  STORES,
  upgradeDatabase
};
