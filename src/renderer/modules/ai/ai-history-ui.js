/**
 * AI 历史会话面板
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
    showToast,
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

  async function renderSessionsList() {
    if (!historyListEl) return;
    const sessions = await getSortedSessions();
    const activeSessionId = getActiveSessionId();

    historyListEl.innerHTML = '';
    for (const session of sessions) {
      const item = documentRef.createElement('div');
      item.className = 'ai-history-item';
      if (session.id === activeSessionId) {
        item.classList.add('active');
      }
      item.dataset.sessionId = session.id;

      const content = documentRef.createElement('div');
      content.className = 'ai-history-item-content';

      const title = documentRef.createElement('div');
      title.className = 'ai-history-item-title';
      title.textContent = session.title || t('ai.sessionUntitled') || '新会话';

      const meta = documentRef.createElement('div');
      meta.className = 'ai-history-item-meta';
      meta.textContent = session.pinned ? t('ai.pinned') || '置顶' : t('ai.mode') || '模式';

      content.appendChild(title);
      content.appendChild(meta);

      const deleteBtn = documentRef.createElement('button');
      deleteBtn.className = 'ai-history-item-delete';
      deleteBtn.title = t('ai.deleteSession') || '删除会话';
      deleteBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
        '<path fill="currentColor" d="' +
        'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59' +
        'L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>' +
        '</svg>';

      // 左键点击：永久删除
      deleteBtn.addEventListener('click', async e => {
        e.stopPropagation();
        await historyStorage.permanentlyDeleteSession(session.id);
        unbindSessionFromAllTabs(session.id);
        const tabId = getActiveTabId();
        unbindSessionFromTab(tabId, session.id);
        if (getActiveSessionId() === session.id) {
          setActiveSessionId('');
          const next = await getCurrentSession();
          await renderSessionChat(next);
        }
        await renderSessionsList();
        if (showToast) {
          showToast(t('ai.sessionPermanentlyDeleted') || '会话已删除', 'info');
        }
      });

      item.appendChild(content);
      item.appendChild(deleteBtn);

      item.addEventListener('click', async () => {
        await onSelectSession(session.id);
        historyPopup?.classList.remove('visible');
      });

      item.addEventListener('dblclick', async e => {
        e.preventDefault();
        const nextTitle = window.prompt(t('ai.renameSession') || '重命名会话', session.title || '');
        if (typeof nextTitle !== 'string') return;
        const trimmed = nextTitle.trim();
        if (!trimmed) return;
        await updateSession(session.id, { title: trimmed });
        await renderSessionsList();
      });

      item.addEventListener('contextmenu', async e => {
        e.preventDefault();
        const shouldPin = !session.pinned;
        await updateSession(session.id, { pinned: shouldPin });
        await renderSessionsList();
      });

      historyListEl.appendChild(item);
    }
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
      if (!msg || !msg.role || typeof msg.content !== 'string') continue;
      if (msg.role === 'user') {
        addChatMessage(msg.content, 'user');
      } else if (msg.role === 'assistant') {
        addChatMessage(msg.content, 'ai');
      }
    }
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
