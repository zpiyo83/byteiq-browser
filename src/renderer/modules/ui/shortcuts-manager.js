function createShortcutsManager(options) {
  const { actions, documentRef, getActiveTabId, urlInput, windowRef } = options;

  function bindEvents() {
    windowRef.addEventListener('keydown', e => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
      const isInputFocused = tag === 'input' || tag === 'textarea';

      if (e.key === 'Escape') {
        actions.closeAllPanels();
        return;
      }

      if (isCmdOrCtrl && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        actions.switchToNextTab();
        return;
      }

      if (isCmdOrCtrl && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        actions.switchToPrevTab();
        return;
      }

      if (isCmdOrCtrl && e.key === 'w') {
        e.preventDefault();
        actions.closeActiveTab();
        return;
      }

      if (isCmdOrCtrl && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        actions.restoreLastTab();
        return;
      }

      if (isCmdOrCtrl && e.key === 't') {
        e.preventDefault();
        actions.createTab();
        return;
      }

      if ((isCmdOrCtrl && e.key === 'r') || e.key === 'F5') {
        e.preventDefault();
        actions.refreshCurrentPage();
        return;
      }

      if (isInputFocused) return;

      if (isCmdOrCtrl && e.key === 'f') {
        e.preventDefault();
        actions.toggleFind();
      }

      if (isCmdOrCtrl && (e.key === 'l' || e.key === 'k')) {
        e.preventDefault();
        urlInput.focus();
        urlInput.select();
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        actions.openHistory();
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        actions.openDownloads();
      }

      if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        actions.openBookmarks();
      }

      if (isCmdOrCtrl && e.key === 'p') {
        e.preventDefault();
        const wv = documentRef.getElementById(`webview-${getActiveTabId()}`);
        if (wv && wv.tagName === 'WEBVIEW') {
          wv.print();
        }
      }

      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const wv = documentRef.getElementById(`webview-${getActiveTabId()}`);
        if (!wv || wv.tagName !== 'WEBVIEW') return;
        if (e.key === 'ArrowLeft' && wv.canGoBack()) {
          e.preventDefault();
          wv.goBack();
        }
        if (e.key === 'ArrowRight' && wv.canGoForward()) {
          e.preventDefault();
          wv.goForward();
        }
      }
    });
  }

  return {
    bindEvents
  };
}

module.exports = {
  createShortcutsManager
};
