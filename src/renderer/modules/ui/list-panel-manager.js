function createListPanelManager(options) {
  const { documentRef, openTab, store, t } = options;

  function showPanel(panel, listContainer, dataKey, filterText = '') {
    const data = store.get(dataKey, []);
    const emptyKey =
      dataKey === 'history' ? 'panels.history.empty' : 'panels.bookmarks.empty';
    const query = filterText.trim().toLowerCase();
    const filteredData = query
      ? data.filter((item) => {
        const title = (item.title || '').toLowerCase();
        const url = (item.url || '').toLowerCase();
        return title.includes(query) || url.includes(query);
      })
      : data;

    listContainer.innerHTML = '';

    if (filteredData.length === 0) {
      listContainer.innerHTML =
        `<p style="text-align:center;color:#999;padding:20px;">` +
        `${t(emptyKey)}</p>`;
    }

    filteredData.forEach((item) => {
      const itemEl = documentRef.createElement('div');
      itemEl.className = 'list-item';

      const openLink = documentRef.createElement('a');
      openLink.href = '#';
      openLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (item.url) {
          openTab(item.url);
        }
      });

      const title = documentRef.createElement('strong');
      title.innerText = item.title || t('bookmark.empty');
      openLink.appendChild(title);
      openLink.appendChild(documentRef.createElement('br'));

      const urlText = documentRef.createElement('small');
      urlText.style.color = '#999';
      urlText.innerText = item.url || '';
      openLink.appendChild(urlText);

      const deleteBtn = documentRef.createElement('span');
      deleteBtn.className = 'delete-btn';
      const dataIndex = data.indexOf(item);
      deleteBtn.dataset.index = dataIndex;
      deleteBtn.innerText = t('delete');
      deleteBtn.addEventListener('click', (e) => {
        const idx = Number(e.target.dataset.index);
        data.splice(idx, 1);
        store.set(dataKey, data);
        showPanel(panel, listContainer, dataKey, filterText);
      });

      itemEl.appendChild(openLink);
      itemEl.appendChild(deleteBtn);
      listContainer.appendChild(itemEl);
    });

    panel.classList.add('active');
  }

  return {
    showPanel
  };
}

module.exports = {
  createListPanelManager
};
