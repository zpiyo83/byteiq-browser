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
      if (session.deleted) {
        item.classList.add('deleted');
      }
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
      deleteBtn.title = session.deleted
        ? t('ai.restoreSession') || '恢复会话'
        : t('ai.deleteSession') || '删除会话';
      // 根据删除状态显示不同图标
      if (session.deleted) {
        deleteBtn.innerHTML =
          '<svg viewBox="0 0 24 24" width="14" height="14">' +
          '<path fill="currentColor" d="' +
          'M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12' +
          'A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65' +
          'C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1' +
          ' 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z"/>' +
          '</svg>';
      } else {
        deleteBtn.innerHTML =
          '<svg viewBox="0 0 24 24" width="14" height="14">' +
          '<path fill="currentColor" d="' +
          'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59' +
          'L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>' +
          '</svg>';
      }

      // 左键点击：删除/恢复
      deleteBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const shouldDelete = !session.deleted;
        await updateSession(session.id, {
          deleted: shouldDelete,
          pinned: shouldDelete ? false : session.pinned
        });
        const tabId = getActiveTabId();
        if (shouldDelete) {
          unbindSessionFromTab(tabId, session.id);
          if (getActiveSessionId() === session.id) {
            setActiveSessionId('');
            const next = await getCurrentSession();
            await renderSessionChat(next);
          }
        }
        await renderSessionsList();
        if (showToast) {
          showToast(
            shouldDelete
              ? t('ai.sessionDeleted') || '会话已删除'
              : t('ai.sessionRestored') || '会话已恢复',
            'info'
          );
        }
      });

      // 右键点击：永久删除（仅对已删除的会话）
      deleteBtn.addEventListener('contextmenu', async e => {
        e.preventDefault();
        e.stopPropagation();
        if (!session.deleted) {
          // 先软删除
          await updateSession(session.id, { deleted: true, pinned: false });
          const tabId = getActiveTabId();
          unbindSessionFromTab(tabId, session.id);
          if (getActiveSessionId() === session.id) {
            setActiveSessionId('');
            const next = await getCurrentSession();
            await renderSessionChat(next);
          }
          await renderSessionsList();
          if (showToast) {
            showToast(t('ai.sessionDeleted') || '会话已删除，右键可永久删除', 'info');
          }
        } else {
          // 永久删除
          if (
            window.confirm(
              t('ai.confirmPermanentDelete') || '确定要永久删除此会话吗？此操作不可撤销。'
            )
          ) {
            await historyStorage.permanentlyDeleteSession(session.id);
            await renderSessionsList();
            if (showToast) {
              showToast(t('ai.sessionPermanentlyDeleted') || '会话已永久删除', 'info');
            }
          }
        }
      });

      item.appendChild(content);
      item.appendChild(deleteBtn);

      item.addEventListener('click', async () => {
        if (session.deleted) {
          await updateSession(session.id, { deleted: false });
          await renderSessionsList();
          return;
        }
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
      historyBtn.addEventListener('click', async () => {
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
        if (!historyPopup.contains(e.target) && e.target !== historyBtn) {
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
