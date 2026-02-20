function createContextMenuManager(options) {
  const {
    clipboard,
    contextMenu,
    documentRef,
    getActiveTabId,
    getTabById,
    tabContextMenu,
    tabActions,
    windowRef
  } = options;

  let tabContextTargetId = null;

  function hideContextMenus() {
    if (contextMenu) {
      contextMenu.style.display = 'none';
    }
    if (tabContextMenu) {
      tabContextMenu.style.display = 'none';
    }
  }

  function showTabContextMenu(x, y, id) {
    if (!tabContextMenu) return;
    const tab = getTabById(id);
    if (!tab) return;

    tabContextTargetId = id;
    const pinItem = tabContextMenu.querySelector('[data-action="pin"]');
    const unpinItem = tabContextMenu.querySelector('[data-action="unpin"]');
    if (pinItem) {
      pinItem.style.display = tab.pinned ? 'none' : 'block';
    }
    if (unpinItem) {
      unpinItem.style.display = tab.pinned ? 'block' : 'none';
    }

    tabContextMenu.style.top = `${y}px`;
    tabContextMenu.style.left = `${x}px`;
    tabContextMenu.style.display = 'block';
  }

  function bindTabContextActions() {
    if (!tabContextMenu) return;
    tabContextMenu.addEventListener('click', e => {
      const item = e.target.closest('[data-action]');
      const action = item ? item.dataset.action : null;
      if (!action || !tabContextTargetId) return;

      if (action === 'duplicate') {
        tabActions.duplicateTab(tabContextTargetId);
      }
      if (action === 'pin') {
        tabActions.setTabPinned(tabContextTargetId, true);
      }
      if (action === 'unpin') {
        tabActions.setTabPinned(tabContextTargetId, false);
      }
      if (action === 'close') {
        tabActions.closeTab(tabContextTargetId);
      }
      if (action === 'close-others') {
        tabActions.closeOtherTabs(tabContextTargetId);
      }
      if (action === 'close-right') {
        tabActions.closeTabsToRight(tabContextTargetId);
      }

      tabContextTargetId = null;
      hideContextMenus();
    });
  }

  function bindPageContextActions() {
    const ctxBack = documentRef.getElementById('ctx-back');
    const ctxForward = documentRef.getElementById('ctx-forward');
    const ctxReload = documentRef.getElementById('ctx-reload');
    const ctxCopy = documentRef.getElementById('ctx-copy');
    const ctxPaste = documentRef.getElementById('ctx-paste');
    const ctxInspect = documentRef.getElementById('ctx-inspect');
    const ctxMute = documentRef.getElementById('ctx-mute');

    if (ctxBack) {
      ctxBack.addEventListener('click', () => {
        const wv = documentRef.getElementById(`webview-${getActiveTabId()}`);
        if (wv && wv.canGoBack()) wv.goBack();
      });
    }

    if (ctxForward) {
      ctxForward.addEventListener('click', () => {
        const wv = documentRef.getElementById(`webview-${getActiveTabId()}`);
        if (wv && wv.canGoForward()) wv.goForward();
      });
    }

    if (ctxReload) {
      ctxReload.addEventListener('click', () => {
        const wv = documentRef.getElementById(`webview-${getActiveTabId()}`);
        if (wv) wv.reload();
      });
    }

    if (ctxCopy) {
      ctxCopy.addEventListener('click', () => {
        const activeEl = documentRef.activeElement;
        if (activeEl && typeof activeEl.value === 'string') {
          const selected = activeEl.value.slice(activeEl.selectionStart, activeEl.selectionEnd);
          clipboard.writeText(selected || activeEl.value);
          return;
        }

        const selectedText = windowRef.getSelection().toString();
        if (selectedText) {
          clipboard.writeText(selectedText);
        }
      });
    }

    if (ctxPaste) {
      ctxPaste.addEventListener('click', () => {
        const activeEl = documentRef.activeElement;
        const text = clipboard.readText();

        if (!activeEl || typeof activeEl.value !== 'string') {
          return;
        }

        const start = activeEl.selectionStart || 0;
        const end = activeEl.selectionEnd || 0;
        const value = activeEl.value;
        activeEl.value = value.slice(0, start) + text + value.slice(end);
        const cursorPos = start + text.length;
        activeEl.setSelectionRange(cursorPos, cursorPos);
        activeEl.dispatchEvent(new Event('input'));
      });
    }

    if (ctxInspect) {
      ctxInspect.addEventListener('click', () => {
        const wv = documentRef.getElementById(`webview-${getActiveTabId()}`);
        if (wv) wv.openDevTools();
      });
    }

    if (ctxMute) {
      ctxMute.addEventListener('click', () => {
        const wv = documentRef.getElementById(`webview-${getActiveTabId()}`);
        if (wv) {
          const isMuted = wv.isAudioMuted();
          wv.setAudioMuted(!isMuted);
          const tabEl = documentRef.getElementById(`tab-${getActiveTabId()}`);
          if (tabEl) {
            tabEl.classList.toggle('muted', !isMuted);
          }
        }
      });
    }
  }

  function bindEvents() {
    windowRef.addEventListener('contextmenu', e => {
      e.preventDefault();
      const tabEl = e.target.closest('.tab');
      if (tabEl) {
        const tabId = tabEl.id.replace('tab-', '');
        showTabContextMenu(e.clientX, e.clientY, tabId);
        if (contextMenu) {
          contextMenu.style.display = 'none';
        }
        return;
      }

      hideContextMenus();
      if (!contextMenu) return;
      const { clientX: x, clientY: y } = e;
      contextMenu.style.top = `${y}px`;
      contextMenu.style.left = `${x}px`;
      contextMenu.style.display = 'block';
    });

    windowRef.addEventListener('click', () => {
      hideContextMenus();
    });

    bindTabContextActions();
    bindPageContextActions();
  }

  return {
    bindEvents,
    hideContextMenus,
    showTabContextMenu
  };
}

module.exports = {
  createContextMenuManager
};
