// Tab ordering helpers
function createTabOrderManager(options) {
  const { documentRef, tabsBar, newTabBtn } = options;

  function renderTabOrder(tabs) {
    const pinnedTabs = tabs.filter(tab => tab.pinned);
    const normalTabs = tabs.filter(tab => !tab.pinned);
    const orderedTabs = pinnedTabs.concat(normalTabs);

    orderedTabs.forEach((tab, index) => {
      const tabEl = documentRef.getElementById(`tab-${tab.id}`);
      if (tabEl) {
        tabEl.style.order = index;
      }
    });

    if (newTabBtn) {
      newTabBtn.style.order = orderedTabs.length + 1;
    }
  }

  function getOrderedTabIds() {
    return Array.from(tabsBar.querySelectorAll('.tab')).map(tabEl => {
      return tabEl.id.replace('tab-', '');
    });
  }

  return {
    getOrderedTabIds,
    renderTabOrder
  };
}

module.exports = {
  createTabOrderManager
};
