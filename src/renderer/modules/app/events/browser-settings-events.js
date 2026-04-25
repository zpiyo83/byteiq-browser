/**
 * 浏览器设置事件绑定模块
 * 负责搜索引擎、暗色模式、缩放、书签、数据管理等事件绑定
 */

/**
 * 绑定浏览器设置相关事件
 * @param {object} deps - 依赖
 */
function bindBrowserSettingsEvents(deps) {
  const {
    bookmarkBtn,
    bookmarksList,
    bookmarksPanel,
    bookmarksSearchInput,
    browserManager,
    clearDataBtn,
    darkModeToggle,
    documentRef,
    exportAiHistoryBtn,
    exportDataBtn,
    historyList,
    historyPanel,
    historyPanelManager,
    historySearchInput,
    incognitoToggleBtn,
    listPanelManager,
    modalManager,
    overlayBackdrop,
    overlayManager,
    restoreSessionToggle,
    ipcRenderer,
    searchEngineSelect,
    setLocale,
    startupUrlInput,
    store,
    tabManager,
    updateBookmarkIcon,
    updateZoomUI,
    zoomInBtn,
    zoomOutBtn,
    zoomResetBtn
  } = deps;

  const document = documentRef;

  // 语言选择
  const langSelect = document.getElementById('lang-select');
  if (langSelect) {
    langSelect.value = store.get('settings.language', 'zh-CN');
    langSelect.addEventListener('change', () => {
      setLocale(langSelect.value);
    });
  }

  // 恢复会话
  if (restoreSessionToggle) {
    restoreSessionToggle.checked = store.get('settings.restoreSession', false);
    restoreSessionToggle.addEventListener('change', () => {
      store.set('settings.restoreSession', restoreSessionToggle.checked);
    });
  }

  // 书签按钮
  bookmarkBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
    if (!wv || wv.tagName !== 'WEBVIEW') return;

    const url = wv.getURL();
    const title = wv.getTitle();
    const bookmarks = store.get('bookmarks', []);
    const index = bookmarks.findIndex(item => item.url === url);

    if (index > -1) {
      bookmarks.splice(index, 1);
    } else {
      bookmarks.unshift({ url, title, time: new Date().toISOString() });
    }

    store.set('bookmarks', bookmarks);
    updateBookmarkIcon(url);
  });

  // 设置面板导航
  document.querySelectorAll('.settings-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.getAttribute('data-section');
      if (!section) return;

      document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.settings-section').forEach(s => {
        s.classList.remove('active');
        s.style.animation = 'none';
        s.offsetHeight;
        s.style.animation = '';
      });
      const targetSection = document.getElementById(`settings-${section}`);
      if (targetSection) {
        targetSection.classList.add('active');
      }
    });
  });

  // 历史搜索
  if (historySearchInput) {
    historySearchInput.addEventListener('input', () => {
      historyPanelManager.showPanel(historyPanel, historyList, historySearchInput.value);
    });
  }

  // 书签搜索
  if (bookmarksSearchInput) {
    bookmarksSearchInput.addEventListener('input', () => {
      listPanelManager.showPanel(
        bookmarksPanel,
        bookmarksList,
        'bookmarks',
        bookmarksSearchInput.value
      );
    });
  }

  // 隐身模式
  incognitoToggleBtn.addEventListener('click', () => {
    browserManager.toggleIncognito();
  });

  // 暗色模式
  if (darkModeToggle) {
    const savedDarkMode = store.get('settings.darkMode');
    darkModeToggle.checked = savedDarkMode === true;

    darkModeToggle.addEventListener('change', () => {
      const isDark = darkModeToggle.checked;
      document.body.classList.toggle('dark-mode', isDark);
      store.set('settings.darkMode', isDark === true);
    });
  }

  // 缩放控制
  zoomInBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
    if (wv && wv.tagName === 'WEBVIEW') {
      wv.getZoomFactor(factor => {
        const newFactor = factor + 0.1;
        wv.setZoomFactor(newFactor);
        updateZoomUI(newFactor);
        browserManager.setZoomForUrl(wv.getURL(), newFactor);
      });
    }
  });

  zoomOutBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
    if (wv && wv.tagName === 'WEBVIEW') {
      wv.getZoomFactor(factor => {
        const newFactor = Math.max(0.2, factor - 0.1);
        wv.setZoomFactor(newFactor);
        updateZoomUI(newFactor);
        browserManager.setZoomForUrl(wv.getURL(), newFactor);
      });
    }
  });

  zoomResetBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
    if (wv && wv.tagName === 'WEBVIEW') {
      wv.setZoomFactor(1.0);
      updateZoomUI(1.0);
      browserManager.setZoomForUrl(wv.getURL(), 1.0);
    }
  });

  // 搜索引擎
  searchEngineSelect.addEventListener('change', () => {
    store.set('settings.searchEngine', searchEngineSelect.value);
  });

  // 启动URL
  startupUrlInput.addEventListener('change', () => {
    store.set('settings.startupUrl', startupUrlInput.value);
  });

  // 清除数据
  clearDataBtn.addEventListener('click', async () => {
    const confirmed = await modalManager.confirmDelete(
      '确定要清除所有浏览数据吗？此操作不可撤销。',
      '清除数据'
    );
    if (confirmed) {
      store.set('history', []);
      store.set('bookmarks', []);
      await modalManager.success('数据已清除', '完成');
    }
  });

  // 实验功能：批量待办开关
  const batchTodoToggle = document.getElementById('experimental-batch-todo-toggle');
  if (batchTodoToggle) {
    batchTodoToggle.checked = store.get('settings.experimentalBatchTodo', false);
    batchTodoToggle.addEventListener('change', () => {
      store.set('settings.experimentalBatchTodo', batchTodoToggle.checked);
    });
  }

  // 导出数据
  exportDataBtn.addEventListener('click', () => {
    const data = {
      bookmarks: store.get('bookmarks', []),
      history: store.get('history', []),
      settings: store.get('settings', {})
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `byteiq-browser-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // 导出AI对话历史
  const exportAiDialog = documentRef.getElementById('export-ai-dialog');
  const exportAiDialogList = documentRef.getElementById('export-ai-dialog-list');
  const exportAiSelectAll = documentRef.getElementById('export-ai-select-all');
  const exportAiDialogClose = documentRef.getElementById('export-ai-dialog-close');
  const exportAiDialogCancel = documentRef.getElementById('export-ai-dialog-cancel');
  const exportAiDialogConfirm = documentRef.getElementById('export-ai-dialog-confirm');

  // 获取 AI 历史存储实例
  let aiHistoryStorage = null;
  function getAiHistoryStorage() {
    if (!aiHistoryStorage) {
      try {
        const { getAIHistoryStorage } = require('../../storage/ai-history-storage');
        aiHistoryStorage = getAIHistoryStorage();
      } catch {
        return null;
      }
    }
    return aiHistoryStorage;
  }

  // 格式化日期
  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return (
      d.toLocaleDateString() +
      ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  }

  // 打开会话选择弹窗
  async function openExportAiDialog() {
    const storage = getAiHistoryStorage();
    if (!storage) return;

    await storage.init();
    const sessions = await storage.getSessions({ includeDeleted: false, limit: 1000 });
    sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    exportAiDialogList.innerHTML = '';
    for (const session of sessions) {
      const item = documentRef.createElement('div');
      item.className = 'export-ai-dialog-item';
      item.dataset.sessionId = session.id;
      item.innerHTML =
        '<input type="checkbox" data-session-id="' +
        session.id +
        '">' +
        '<div class="export-ai-dialog-item-info">' +
        '<div class="export-ai-dialog-item-title">' +
        (session.title || '未命名会话') +
        '</div>' +
        '<div class="export-ai-dialog-item-meta">' +
        (session.messageCount || 0) +
        ' 条消息 · ' +
        formatDate(session.updatedAt) +
        '</div>' +
        '</div>';
      // 点击整行切换 checkbox
      item.addEventListener('click', e => {
        if (e.target.tagName === 'INPUT') return;
        const cb = item.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = !cb.checked;
      });
      exportAiDialogList.appendChild(item);
    }

    exportAiSelectAll.checked = false;
    exportAiDialog.classList.add('visible');
  }

  function closeExportAiDialog() {
    exportAiDialog.classList.remove('visible');
  }

  // 全选/取消全选
  if (exportAiSelectAll) {
    exportAiSelectAll.addEventListener('change', () => {
      const checked = exportAiSelectAll.checked;
      exportAiDialogList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = checked;
      });
    });
  }

  // 关闭弹窗
  if (exportAiDialogClose) exportAiDialogClose.addEventListener('click', closeExportAiDialog);
  if (exportAiDialogCancel) exportAiDialogCancel.addEventListener('click', closeExportAiDialog);

  // 确认导出
  if (exportAiDialogConfirm) {
    exportAiDialogConfirm.addEventListener('click', async () => {
      const checkedIds = [];
      exportAiDialogList.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        checkedIds.push(cb.dataset.sessionId);
      });
      if (checkedIds.length === 0) return;

      const storage = getAiHistoryStorage();
      if (!storage) return;

      // 构建导出数据
      const exportData = {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        sessions: []
      };

      for (const sessionId of checkedIds) {
        const session = await storage.getSession(sessionId);
        if (!session) continue;
        const messages = await storage.getMessages(sessionId, { limit: 10000 });

        // 处理消息，解析思考内容和工具调用
        const processedMessages = messages.map(msg => {
          const entry = {
            role: msg.role,
            createdAt: msg.createdAt ? new Date(msg.createdAt).toISOString() : null
          };

          if (msg.role === 'user') {
            entry.content = msg.content;
          } else if (msg.role === 'assistant') {
            // 解析 <!--think-->...<!--endthink--> 标记
            const thinkMatch =
              typeof msg.content === 'string'
                ? msg.content.match(/<!--think-->([\s\S]*?)<!--endthink-->/)
                : null;
            if (thinkMatch) {
              entry.thinking = thinkMatch[1].trim();
              const remaining = msg.content
                .replace(/<!--think-->[\s\S]*?<!--endthink-->/, '')
                .trim();
              entry.content = remaining || null;
            } else {
              entry.content = msg.content || null;
            }
            // 工具调用信息
            if (msg.metadata && msg.metadata.toolCalls) {
              entry.toolCalls = msg.metadata.toolCalls.map(call => ({
                id: call.id,
                name: call.name,
                arguments: call.arguments
              }));
            }
          } else if (msg.role === 'tool') {
            entry.content = msg.content;
            if (msg.metadata) {
              entry.toolCallId = msg.metadata.toolCallId || null;
              entry.toolName = msg.metadata.toolName || null;
              entry.toolStatus = msg.metadata.status || null;
              entry.toolDescription = msg.metadata.description || null;
            }
          }

          return entry;
        });

        exportData.sessions.push({
          id: session.id,
          title: session.title,
          mode: session.mode,
          createdAt: session.createdAt ? new Date(session.createdAt).toISOString() : null,
          updatedAt: session.updatedAt ? new Date(session.updatedAt).toISOString() : null,
          messageCount: session.messageCount || processedMessages.length,
          messages: processedMessages
        });
      }

      // 通过主进程保存文件
      const defaultName = `byteiq-ai-history-${new Date().toISOString().split('T')[0]}.json`;
      const result = await ipcRenderer.invoke('show-save-json', {
        defaultName,
        content: JSON.stringify(exportData, null, 2)
      });

      if (result.success) {
        closeExportAiDialog();
      }
    });
  }

  // 绑定导出按钮
  if (exportAiHistoryBtn) {
    exportAiHistoryBtn.addEventListener('click', openExportAiDialog);
  }

  // 关闭覆盖层
  document.querySelectorAll('.close-overlay').forEach(btn => {
    btn.addEventListener('click', () => {
      overlayManager.closeAllOverlays();
    });
  });

  if (overlayBackdrop) {
    overlayBackdrop.addEventListener('click', () => {
      overlayManager.closeAllOverlays();
    });
  }
}

module.exports = { bindBrowserSettingsEvents };
