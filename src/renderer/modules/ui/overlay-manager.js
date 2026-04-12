function createOverlayManager(options) {
  const { documentRef, overlayBackdrop } = options;

  function getActiveOverlayPanel() {
    return documentRef.querySelector('.overlay-panel.active');
  }

  function setOverlayBackdropActive(active) {
    if (!overlayBackdrop) return;
    overlayBackdrop.classList.toggle('active', active);
  }

  function closeAllOverlays() {
    // 关闭前先让所有输入框失焦，确保 change 事件触发以保存设置值
    const activeInput = documentRef.activeElement;
    if (activeInput && (activeInput.tagName === 'INPUT' || activeInput.tagName === 'SELECT')) {
      activeInput.blur();
    }
    documentRef.querySelectorAll('.overlay-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    setOverlayBackdropActive(false);
  }

  function openOverlay(panelEl) {
    if (!panelEl) return;
    documentRef.querySelectorAll('.overlay-panel').forEach(panel => {
      if (panel !== panelEl) panel.classList.remove('active');
    });
    panelEl.classList.add('active');
    setOverlayBackdropActive(true);

    requestAnimationFrame(() => {
      const search = panelEl.querySelector('.panel-search input');
      if (search) {
        search.focus();
        return;
      }
      const firstInput = panelEl.querySelector('input');
      if (firstInput) {
        firstInput.focus();
      }
    });
  }

  return {
    closeAllOverlays,
    getActiveOverlayPanel,
    openOverlay,
    setOverlayBackdropActive
  };
}

module.exports = {
  createOverlayManager
};
