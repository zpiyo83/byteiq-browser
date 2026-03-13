/**
 * AI对话历史记录存储服务
 * 使用IndexedDB实现高性能、可搜索的历史记录存储
 * 分离session元数据和messages存储，支持分页加载
 */

/* global indexedDB */

const DB_NAME = 'ByteIQ_AI_History';
const DB_VERSION = 1;

// 存储对象名称
const STORES = {
  sessions: 'sessions', // session元数据
  messages: 'messages', // 消息数据（按session分组）
  searchIndex: 'searchIndex' // 搜索索引
};

class AIHistoryStorage {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  /**
   * 初始化IndexedDB数据库
   */
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

        // sessions存储：session元数据
        if (!db.objectStoreNames.contains(STORES.sessions)) {
          const sessionStore = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
          sessionStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
          sessionStore.createIndex('deleted', 'deleted', { unique: false });
          sessionStore.createIndex('pinned', 'pinned', { unique: false });
        }

        // messages存储：消息数据
        if (!db.objectStoreNames.contains(STORES.messages)) {
          const msgStore = db.createObjectStore(STORES.messages, { keyPath: 'id' });
          msgStore.createIndex('sessionId', 'sessionId', { unique: false });
          msgStore.createIndex('createdAt', 'createdAt', { unique: false });
          msgStore.createIndex('role', 'role', { unique: false });
        }

        // searchIndex存储：搜索索引
        if (!db.objectStoreNames.contains(STORES.searchIndex)) {
          const searchStore = db.createObjectStore(STORES.searchIndex, { keyPath: 'id' });
          searchStore.createIndex('sessionId', 'sessionId', { unique: false });
          searchStore.createIndex('text', 'text', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * 获取事务
   */
  getTransaction(storeNames, mode = 'readonly') {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.transaction(storeNames, mode);
  }

  // ==================== Session 操作 ====================

  /**
   * 创建新session
   */
  async createSession(sessionData) {
    await this.init();
    const session = {
      id: sessionData.id || this.generateId(),
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
      const tx = this.getTransaction([STORES.sessions], 'readwrite');
      const store = tx.objectStore(STORES.sessions);
      const request = store.add(session);

      request.onsuccess = () => resolve(session);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 获取单个session
   */
  async getSession(sessionId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.getTransaction([STORES.sessions]);
      const store = tx.objectStore(STORES.sessions);
      const request = store.get(sessionId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 更新session
   */
  async updateSession(sessionId, patch) {
    await this.init();
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const updated = {
      ...session,
      ...patch,
      updatedAt: Date.now()
    };

    return new Promise((resolve, reject) => {
      const tx = this.getTransaction([STORES.sessions], 'readwrite');
      const store = tx.objectStore(STORES.sessions);
      const request = store.put(updated);

      request.onsuccess = () => resolve(updated);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 删除session（软删除）
   */
  async deleteSession(sessionId) {
    return this.updateSession(sessionId, { deleted: true });
  }

  /**
   * 永久删除session及其所有消息
   */
  async permanentlyDeleteSession(sessionId) {
    await this.init();
    const tx = this.getTransaction(
      [STORES.sessions, STORES.messages, STORES.searchIndex],
      'readwrite'
    );

    // 删除session
    tx.objectStore(STORES.sessions).delete(sessionId);

    // 删除相关消息
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

    // 删除搜索索引
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

  /**
   * 获取所有sessions（支持分页和排序）
   */
  async getSessions(options = {}) {
    await this.init();
    const { includeDeleted = false, limit = 100, offset = 0, sortBy = 'updatedAt' } = options;

    return new Promise((resolve, reject) => {
      const tx = this.getTransaction([STORES.sessions]);
      const store = tx.objectStore(STORES.sessions);
      const index = store.index(sortBy);

      const sessions = [];
      let skipped = 0;
      let count = 0;

      // 使用游标倒序遍历（最新的在前）
      const request = index.openCursor(null, 'prev');

      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(sessions);
          return;
        }

        const session = cursor.value;

        // 跳过已删除的（除非包含）
        if (!includeDeleted && session.deleted) {
          cursor.continue();
          return;
        }

        // 跳过offset个
        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }

        // 收集数据
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

  /**
   * 统计session数量
   */
  async countSessions(includeDeleted = false) {
    await this.init();
    const sessions = await this.getSessions({ includeDeleted, limit: Infinity });
    return sessions.length;
  }

  // ==================== Message 操作 ====================

  /**
   * 添加消息到session
   */
  async addMessage(sessionId, message) {
    await this.init();
    const msg = {
      id: this.generateId(),
      sessionId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt || Date.now(),
      metadata: message.metadata || {}
    };

    const tx = this.getTransaction(
      [STORES.messages, STORES.sessions, STORES.searchIndex],
      'readwrite'
    );

    // 保存消息
    const msgStore = tx.objectStore(STORES.messages);
    msgStore.add(msg);

    // 更新session的messageCount
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

    // 添加搜索索引
    const searchStore = tx.objectStore(STORES.searchIndex);
    searchStore.add({
      id: this.generateId(),
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

  /**
   * 获取session的消息（支持分页）
   */
  async getMessages(sessionId, options = {}) {
    await this.init();
    const { limit = 50, offset = 0 } = options;

    return new Promise((resolve, reject) => {
      const tx = this.getTransaction([STORES.messages]);
      const store = tx.objectStore(STORES.messages);
      const index = store.index('sessionId');

      const messages = [];
      let skipped = 0;
      let count = 0;

      // 按创建时间排序
      const request = index.openCursor(sessionId);

      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(messages);
          return;
        }

        // 跳过offset个
        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }

        // 收集数据
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

  /**
   * 获取session的所有消息数量
   */
  async countMessages(sessionId) {
    await this.init();
    const messages = await this.getMessages(sessionId, { limit: Infinity });
    return messages.length;
  }

  // ==================== 搜索功能 ====================

  /**
   * 搜索消息内容
   */
  async searchMessages(query, options = {}) {
    await this.init();
    const { limit = 50, sessionId = null } = options;
    const searchText = query.toLowerCase();

    return new Promise((resolve, reject) => {
      const tx = this.getTransaction([STORES.searchIndex, STORES.messages]);
      const searchStore = tx.objectStore(STORES.searchIndex);

      const results = [];
      let count = 0;

      // 遍历搜索索引
      const request = searchStore.openCursor();

      request.onsuccess = async event => {
        const cursor = event.target.result;
        if (!cursor || count >= limit) {
          resolve(results);
          return;
        }

        const index = cursor.value;

        // 检查session过滤
        if (sessionId && index.sessionId !== sessionId) {
          cursor.continue();
          return;
        }

        // 检查文本匹配
        if (index.text.includes(searchText)) {
          // 获取完整消息
          const msgStore = tx.objectStore(STORES.messages);
          const msgRequest = msgStore.get(index.messageId);

          await new Promise(resolveMsg => {
            msgRequest.onsuccess = () => {
              if (msgRequest.result) {
                results.push({
                  message: msgRequest.result,
                  matchedText: index.text
                });
                count++;
              }
              resolveMsg();
            };
            msgRequest.onerror = () => resolveMsg();
          });
        }

        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ==================== 数据迁移 ====================

  /**
   * 从旧版electron-store数据迁移
   */
  async migrateFromLegacy(store) {
    await this.init();
    const legacySessions = store?.get('ai.sessions', {});
    if (!legacySessions || Object.keys(legacySessions).length === 0) {
      return { migrated: 0 };
    }

    let migrated = 0;
    for (const [sessionId, session] of Object.entries(legacySessions)) {
      try {
        // 创建session元数据
        await this.createSession({
          id: sessionId,
          title: session.title,
          pinned: session.pinned,
          deleted: session.deleted,
          mode: session.mode,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          pageContext: session.pageContext
        });

        // 迁移消息
        if (session.messages && Array.isArray(session.messages)) {
          for (const msg of session.messages) {
            await this.addMessage(sessionId, {
              role: msg.role,
              content: msg.content,
              createdAt: msg.createdAt || Date.now(),
              metadata: msg.metadata || {}
            });
          }
        }

        migrated++;
      } catch (error) {
        console.error(`Failed to migrate session ${sessionId}:`, error);
      }
    }

    return { migrated };
  }

  // ==================== 工具方法 ====================

  /**
   * 生成唯一ID
   */
  generateId() {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * 清除所有数据
   */
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
}

// 单例模式
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
