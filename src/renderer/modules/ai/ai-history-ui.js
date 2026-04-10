/**
 * AI 历史会话面板
 * 支持：日期分组、搜索、相对时间、消息预览、软删除+恢复
 */

function createAiHistoryUI(options) {
  const {
    documentRef,
    historyListEl,
    historyPopup,
    historyBtn,
    closeHistoryBtn,
    historyStorage,
    t,
    getSortedSessions,
    getActiveSessionId,
    getCurrentSession,
    getActiveTabId,
    updateSession,
    unbindSessionFromTab,
    unbindSessionFromAllTabs,
    setActiveSessionId,
    onSelectSession,
    addChatMessage,
    aiChatArea
  } = options;

  // 搜索框
  const searchInput = documentRef.getElementById('ai-history-search-input');
  let searchQuery = '';
  let searchDebounceTimer = null;

  /**
   * 格式化相对时间
   */
  function relativeTime(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days === 0) {
      if (hours > 0) return `${hours}小时前`;
      if (minutes > 0) return `${minutes}分钟前`;
      return '刚刚';
    }
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    if (days < 30) return `${Math.floor(days / 7)}周前`;
    if (days < 365) return `${Math.floor(days / 30)}月前`;
    return `${Math.floor(days / 365)}年前`;
  }

  /**
   * 获取日期分组标签
   */
  function getDateGroup(timestamp) {
    if (!timestamp) return 'earlier';
    const now = new Date();
    const date = new Date(timestamp);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((today - itemDate) / 86400000);

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return 'week';
    return 'earlier';
  }

  const DATE_GROUP_LABELS = {
    today: '今天',
    yesterday: '昨天',
    week: '本周',
    earlier: '更早'
  };

  const DATE_GROUP_ORDER = ['today', 'yesterday', 'week', 'earlier'];

  /**
   * 截取消息预览文本
   */
  function previewText(content, maxLen) {
    if (!content || typeof content !== 'string') return '';
    const clean = content
      .replace(/<!--think-->[\s\S]*?<!--endthink-->/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\n/g, ' ')
      .trim();
    if (maxLen && clean.length > maxLen) return clean.slice(0, maxLen) + '...';
    return clean;
  }

  /**
   * 渲染会话列表（带日期分组和搜索）
   */
  async function renderSessionsList() {
    if (!historyListEl) return;
    let sessions = await getSortedSessions();
    const activeSessionId = getActiveSessionId();

    // 搜索过滤
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      sessions = sessions.filter(s => (s.title || '').toLowerCase().includes(q));
      // 也搜索消息内容
      if (sessions.length === 0) {
        try {
          const results = await historyStorage.searchMessages(q, { limit: 20 });
          const sessionIds = new Set(results.map(r => r.message?.sessionId).filter(Boolean));
          const matched = [];
          for (const sid of sessionIds) {
            const s = await historyStorage.getSession(sid);
            if (s && !s.deleted) matched.push(s);
          }
          sessions = matched;
        } catch {
          // 搜索失败则仅用标题过滤
        }
      }
    }

    // 按日期分组
    const groups = {};
    for (const session of sessions) {
      const group = getDateGroup(session.updatedAt || session.createdAt);
      if (!groups[group]) groups[group] = [];
      groups[group].push(session);
    }

    historyListEl.innerHTML = '';

    for (const groupKey of DATE_GROUP_ORDER) {
      const items = groups[groupKey];
      if (!items || items.length === 0) continue;

      // 分组标题
      const groupHeader = documentRef.createElement('div');
      groupHeader.className = 'ai-history-group-label';
      groupHeader.textContent = DATE_GROUP_LABELS[groupKey] || groupKey;
      historyListEl.appendChild(groupHeader);

      for (const session of items) {
        const item = documentRef.createElement('div');
        item.className = 'ai-history-item';
        if (session.id === activeSessionId) {
          item.classList.add('active');
        }
        item.dataset.sessionId = session.id;

        const content = documentRef.createElement('div');
        content.className = 'ai-history-item-content';

        const titleRow = documentRef.createElement('div');
        titleRow.className = 'ai-history-item-title-row';

        const title = documentRef.createElement('div');
        title.className = 'ai-history-item-title';
        title.textContent = session.title || t('ai.sessionUntitled') || '新会话';

        const time = documentRef.createElement('span');
        time.className = 'ai-history-item-time';
        time.textContent = relativeTime(session.updatedAt || session.createdAt);

        titleRow.appendChild(title);
        titleRow.appendChild(time);

        // 消息预览
        const preview = documentRef.createElement('div');
        preview.className = 'ai-history-item-preview';
        preview.textContent =
          previewText(session.lastMessage, 50) ||
          (session.messageCount > 0 ? `${session.messageCount}条消息` : '');

        content.appendChild(titleRow);
        content.appendChild(preview);

        // 操作按钮区
        const actions = documentRef.createElement('div');
        actions.className = 'ai-history-item-actions';

        if (session.deleted) {
          // 已删除：恢复按钮
          const restoreBtn = documentRef.createElement('button');
          restoreBtn.className = 'ai-history-item-action restore';
          restoreBtn.title = t('ai.restoreSession') || '恢复会话';
          restoreBtn.textContent = '↩';
          restoreBtn.addEventListener('click', async e => {
            e.stopPropagation();
            await historyStorage.restoreSession(session.id);
            await renderSessionsList();
          });
          actions.appendChild(restoreBtn);
        }

        // 删除按钮
        const deleteBtn = documentRef.createElement('button');
        deleteBtn.className = 'ai-history-item-action delete';
        deleteBtn.title = t('ai.deleteSession') || '删除会话';
        deleteBtn.innerHTML =
          '<svg viewBox="0 0 24 24" width="12" height="12">' +
          '<path fill="currentColor" d="' +
          'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59' +
          'L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>' +
          '</svg>';
        deleteBtn.addEventListener('click', async e => {
          e.stopPropagation();
          if (session.deleted) {
            // 已删除则永久删除
            await historyStorage.permanentlyDeleteSession(session.id);
            unbindSessionFromAllTabs(session.id);
            const tabId = getActiveTabId();
            unbindSessionFromTab(tabId, session.id);
            if (getActiveSessionId() === session.id) {
              setActiveSessionId('');
              const next = await getCurrentSession();
              await renderSessionChat(next);
            }
          } else {
            // 软删除
            await historyStorage.deleteSession(session.id);
            if (getActiveSessionId() === session.id) {
              setActiveSessionId('');
              const next = await getCurrentSession();
              await renderSessionChat(next);
            }
          }
          await renderSessionsList();
        });
        actions.appendChild(deleteBtn);

        item.appendChild(content);
        item.appendChild(actions);

        // 点击切换会话
        item.addEventListener('click', async () => {
          if (session.deleted) return;
          await onSelectSession(session.id);
          historyPopup?.classList.remove('visible');
        });

        // 双击重命名
        item.addEventListener('dblclick', async e => {
          if (session.deleted) return;
          e.preventDefault();
          const nextTitle = window.prompt(
            t('ai.renameSession') || '重命名会话',
            session.title || ''
          );
          if (typeof nextTitle !== 'string') return;
          const trimmed = nextTitle.trim();
          if (!trimmed) return;
          await updateSession(session.id, { title: trimmed });
          await renderSessionsList();
        });

        // 右键置顶/取消置顶
        item.addEventListener('contextmenu', async e => {
          if (session.deleted) return;
          e.preventDefault();
          const shouldPin = !session.pinned;
          await updateSession(session.id, { pinned: shouldPin });
          await renderSessionsList();
        });

        historyListEl.appendChild(item);
      }
    }

    // 空状态
    if (historyListEl.children.length === 0) {
      const empty = documentRef.createElement('div');
      empty.className = 'ai-history-empty';
      empty.textContent = searchQuery
        ? t('ai.noSearchResults') || '未找到匹配的会话'
        : t('ai.noSessions') || '暂无会话记录';
      historyListEl.appendChild(empty);
    }
  }

  /**
   * 渲染历史工具卡片
   */
  function renderHistoryToolCard(toolName, status, description) {
    const msg = documentRef.createElement('div');
    msg.className = 'chat-message ai tool-card';

    const header = documentRef.createElement('div');
    header.className = 'tool-card-header';

    const titleEl = documentRef.createElement('div');
    titleEl.className = 'tool-card-title';
    titleEl.textContent = `工具：${getToolTitle(toolName)}`;
    header.appendChild(titleEl);

    if (status) {
      const statusEl = documentRef.createElement('span');
      statusEl.className = `tool-card-status ${status}`;
      statusEl.textContent = getToolStatusLabel(status);
      header.appendChild(statusEl);
    }

    const descEl = documentRef.createElement('div');
    descEl.className = 'tool-card-desc';
    descEl.textContent = description || '';
    msg.appendChild(header);
    msg.appendChild(descEl);

    aiChatArea.appendChild(msg);
    return msg;
  }

  function getToolTitle(toolName) {
    const titles = {
      get_page_info: '获取页面信息',
      click_element: '点击元素',
      input_text: '输入文本',
      end_session: '结束会话'
    };
    return titles[toolName] || toolName || '工具';
  }

  function getToolStatusLabel(status) {
    const labels = { success: '已完成', error: '失败', pending: '执行中' };
    return labels[status] || '状态';
  }

  async function renderSessionChat(session) {
    if (!session) return;
    aiChatArea.innerHTML = '';

    // 从IndexedDB加载消息
    const messages = await historyStorage.getMessages(session.id, { limit: 1000 });

    if (!messages || messages.length === 0) {
      const welcomeMsg = documentRef.createElement('div');
      welcomeMsg.className = 'chat-message ai';
      welcomeMsg.innerHTML = `<span>${t('ai.welcome')}</span>`;
      aiChatArea.appendChild(welcomeMsg);
      return;
    }

    for (const msg of messages) {
      if (!msg) continue;

      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          addChatMessage(msg.content, 'user');
        }
      } else if (msg.role === 'assistant') {
        // assistant消息：addChatMessage已支持<!--think-->标记渲染思考下拉框
        const content = typeof msg.content === 'string' ? msg.content : '';
        // 有内容或思考标记时才渲染（纯工具调用的assistant可能内容为空）
        if (content.trim()) {
          addChatMessage(content, 'ai');
        }
      } else if (msg.role === 'tool') {
        // 工具结果消息：渲染为工具卡片
        const meta = msg.metadata || {};
        renderHistoryToolCard(
          meta.toolName || '',
          meta.status || 'success',
          meta.description || ''
        );
      }
    }

    // 滚动到底部
    aiChatArea.scrollTop = aiChatArea.scrollHeight;
  }

  function bindHistoryPanelEvents() {
    // 历史按钮点击显示/隐藏历史面板
    if (historyBtn) {
      historyBtn.addEventListener('click', async e => {
        if (e && typeof e.stopPropagation === 'function') {
          e.stopPropagation();
        }
        historyPopup?.classList.toggle('visible');
        if (historyPopup?.classList.contains('visible')) {
          await renderSessionsList();
        }
      });
    }

    // 关闭历史面板按钮
    if (closeHistoryBtn) {
      closeHistoryBtn.addEventListener('click', () => {
        historyPopup?.classList.remove('visible');
      });
    }

    // 搜索输入
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(async () => {
          searchQuery = searchInput.value.trim();
          await renderSessionsList();
        }, 300);
      });
    }

    // 点击历史面板外部关闭
    documentRef.addEventListener('click', e => {
      if (historyPopup?.classList.contains('visible')) {
        if (!historyPopup.contains(e.target) && !historyBtn?.contains(e.target)) {
          historyPopup.classList.remove('visible');
        }
      }
    });
  }

  return {
    renderSessionsList,
    renderSessionChat,
    bindHistoryPanelEvents
  };
}

module.exports = {
  createAiHistoryUI
};
