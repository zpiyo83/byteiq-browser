// Tab history storage
function createTabHistoryManager(store) {
  function saveHistory(url, title) {
    if (!url || url === 'about:blank' || url.startsWith('data:')) return;
    let history = store.get('history', []);
    if (history.length > 0 && history[0].url === url) return;

    history.unshift({
      url,
      title,
      time: new Date().toISOString()
    });

    if (history.length > 1000) history = history.slice(0, 1000);
    store.set('history', history);
  }

  return {
    saveHistory
  };
}

module.exports = {
  createTabHistoryManager
};
