/**
 * AI对话历史记录存储服务
 * 使用IndexedDB实现高性能、可搜索的历史记录存储
 * 分离session元数据和messages存储，支持分页加载
 */

/* global indexedDB */

const { DB_NAME, DB_VERSION, STORES, upgradeDatabase } = require('./ai-history/schema');
const sessionOps = require('./ai-history/sessions');
const messageOps = require('./ai-history/messages');
const searchOps = require('./ai-history/search');
const migrationOps = require('./ai-history/migration');

class AIHistoryStorage {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    if (this.db) return this.db;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = event => {
        const db = event.target.result;
        upgradeDatabase(db);
      };
    });

    return this.initPromise;
  }

  getTransaction(storeNames, mode = 'readonly') {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.transaction(storeNames, mode);
  }

  async createSession(sessionData) {
    return sessionOps.createSession(this, sessionData);
  }

  async getSession(sessionId) {
    return sessionOps.getSession(this, sessionId);
  }

  async updateSession(sessionId, patch) {
    return sessionOps.updateSession(this, sessionId, patch);
  }

  async deleteSession(sessionId) {
    return sessionOps.deleteSession(this, sessionId);
  }

  async permanentlyDeleteSession(sessionId) {
    return sessionOps.permanentlyDeleteSession(this, sessionId);
  }

  async getSessions(options = {}) {
    return sessionOps.getSessions(this, options);
  }

  async countSessions(includeDeleted = false) {
    return sessionOps.countSessions(this, includeDeleted);
  }

  async addMessage(sessionId, message) {
    return messageOps.addMessage(this, sessionId, message);
  }

  async getMessages(sessionId, options = {}) {
    return messageOps.getMessages(this, sessionId, options);
  }

  async countMessages(sessionId) {
    return messageOps.countMessages(this, sessionId);
  }

  async getLastMessage(sessionId) {
    return messageOps.getLastMessage(this, sessionId);
  }

  async searchMessages(query, options = {}) {
    return searchOps.searchMessages(this, query, options);
  }

  async restoreSession(sessionId) {
    return sessionOps.restoreSession(this, sessionId);
  }

  async migrateFromLegacy(store) {
    return migrationOps.migrateFromLegacy(this, store);
  }

  generateId() {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  async clearAll() {
    await this.init();
    const tx = this.getTransaction(
      [STORES.sessions, STORES.messages, STORES.searchIndex],
      'readwrite'
    );

    tx.objectStore(STORES.sessions).clear();
    tx.objectStore(STORES.messages).clear();
    tx.objectStore(STORES.searchIndex).clear();

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // 清除指定会话的所有消息和搜索索引（保留会话本身）
  async clearMessages(sessionId) {
    await this.init();
    const tx = this.getTransaction([STORES.messages, STORES.searchIndex], 'readwrite');

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
}

let storageInstance = null;

function getAIHistoryStorage() {
  if (!storageInstance) {
    storageInstance = new AIHistoryStorage();
  }
  return storageInstance;
}

module.exports = {
  AIHistoryStorage,
  getAIHistoryStorage
};
