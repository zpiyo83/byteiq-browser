function createFindManager(options) {
  const {
    documentRef,
    findBox,
    findClose,
    findInput,
    findNext,
    findPrev,
    findResults,
    getActiveTabId
  } = options;

  function getActiveWebview() {
    return documentRef.getElementById(`webview-${getActiveTabId()}`);
  }

  function closeFind() {
    const wv = getActiveWebview();
    if (wv) {
      wv.stopFindInPage('clearSelection');
    }
    findBox.style.display = 'none';
  }

  function toggleFind() {
    const wv = getActiveWebview();
    if (!wv || wv.tagName !== 'WEBVIEW') return;

    if (findBox.style.display === 'flex') {
      wv.stopFindInPage('clearSelection');
      findBox.style.display = 'none';
    } else {
      findBox.style.display = 'flex';
      findInput.focus();
    }
  }

  function bindEvents() {
    findInput.addEventListener('input', () => {
      const wv = getActiveWebview();
      if (wv && wv.tagName === 'WEBVIEW' && findInput.value) {
        wv.findInPage(findInput.value);
      } else if (wv) {
        wv.stopFindInPage('clearSelection');
        findResults.innerText = '0/0';
      }
    });

    findNext.addEventListener('click', () => {
      const wv = getActiveWebview();
      if (wv && findInput.value) {
        wv.findInPage(findInput.value, { forward: true, findNext: true });
      }
    });

    findPrev.addEventListener('click', () => {
      const wv = getActiveWebview();
      if (wv && findInput.value) {
        wv.findInPage(findInput.value, { forward: false, findNext: true });
      }
    });

    findClose.addEventListener('click', () => {
      closeFind();
    });
  }

  return {
    bindEvents,
    closeFind,
    toggleFind
  };
}

module.exports = {
  createFindManager
};
