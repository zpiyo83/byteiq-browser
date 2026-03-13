/**
 * 历史记录面板管理器
 * 负责历史记录的显示、分组、搜索和删除
 */

// 时间分组工具函数
function getTimeGroup(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (date >= today) {
    return 'today';
  } else if (date >= yesterday) {
    return 'yesterday';
  } else if (date >= weekAgo) {
    return 'thisWeek';
  } else if (date >= monthAgo) {
    return 'thisMonth';
  } else {
    return 'older';
  }
}

// 分组标签
function getGroupLabel(group, t) {
  const labels = {
    today: t('history.group.today') || '今天',
    yesterday: t('history.group.yesterday') || '昨天',
    thisWeek: t('history.group.thisWeek') || '本周',
    thisMonth: t('history.group.thisMonth') || '本月',
    older: t('history.group.older') || '更早'
  };
  return labels[group] || group;
}

// 格式化时间
function formatTime(dateStr) {
  const date = new Date(dateStr);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// 按时间分组历史记录
function groupHistoryByTime(history) {
  const groups = {
    today: [],
    yesterday: [],
    thisWeek: [],
    thisMonth: [],
    older: []
  };

  history.forEach(item => {
    const group = getTimeGroup(item.time);
    groups[group].push(item);
  });

  return groups;
}

function createHistoryPanelManager(options) {
  const { documentRef, openTab, store, t } = options;

  /**
   * 渲染单个历史记录项
   */
  function renderHistoryItem(item, index, data, listContainer, filterText) {
    const itemEl = documentRef.createElement('div');
    itemEl.className = 'history-item';

    // 图标
    const icon = documentRef.createElement('div');
    icon.className = 'history-item-icon';
    icon.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z"/>
      </svg>
    `;

    // 内容区域
    const content = documentRef.createElement('div');
    content.className = 'history-item-content';

    const title = documentRef.createElement('div');
    title.className = 'history-item-title';
    title.textContent = item.title || t('history.untitled') || '无标题';

    const url = documentRef.createElement('div');
    url.className = 'history-item-url';
    url.textContent = item.url || '';

    const time = documentRef.createElement('div');
    time.className = 'history-item-time';
    time.textContent = formatTime(item.time, t);

    content.appendChild(title);
    content.appendChild(url);

    // 点击打开
    itemEl.addEventListener('click', () => {
      if (item.url) {
        openTab(item.url);
      }
    });

    // 删除按钮
    const deleteBtn = documentRef.createElement('button');
    deleteBtn.className = 'history-item-delete';
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14">
        <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
      </svg>
    `;
    deleteBtn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = data.indexOf(item);
      if (idx > -1) {
        data.splice(idx, 1);
        store.set('history', data);
        showPanel(filterText);
      }
    });

    itemEl.appendChild(icon);
    itemEl.appendChild(content);
    itemEl.appendChild(time);
    itemEl.appendChild(deleteBtn);

    return itemEl;
  }

  /**
   * 渲染分组标题
   */
  function renderGroupHeader(group, listContainer) {
    const header = documentRef.createElement('div');
    header.className = 'history-group-header';
    header.textContent = getGroupLabel(group, t);
    listContainer.appendChild(header);
  }

  /**
   * 显示历史记录面板
   */
  function showPanel(panel, listContainer, filterText = '') {
    const history = store.get('history', []);
    const query = filterText.trim().toLowerCase();

    // 过滤数据
    const filteredHistory = query
      ? history.filter(item => {
          const title = (item.title || '').toLowerCase();
          const url = (item.url || '').toLowerCase();
          return title.includes(query) || url.includes(query);
        })
      : history;

    listContainer.innerHTML = '';

    // 空状态
    if (filteredHistory.length === 0) {
      listContainer.innerHTML = `
        <div class="history-empty">
          <svg viewBox="0 0 24 24" width="48" height="48">
            <path fill="currentColor" d="M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.13 8.11,16.73L6.7,18.14C8.25,19.87 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3M12,8V13L16.28,15.54L17,14.33L13.5,12.25V8H12Z"/>
          </svg>
          <p>${t('panels.history.empty') || '暂无历史记录'}</p>
        </div>
      `;
      panel.classList.add('active');
      return;
    }

    // 按时间分组显示
    if (!query) {
      const groups = groupHistoryByTime(filteredHistory);
      const groupOrder = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'older'];

      groupOrder.forEach(group => {
        if (groups[group].length > 0) {
          renderGroupHeader(group, listContainer);
          groups[group].forEach(item => {
            const itemEl = renderHistoryItem(item, 0, history, listContainer, filterText);
            listContainer.appendChild(itemEl);
          });
        }
      });
    } else {
      // 搜索模式下不分组
      filteredHistory.forEach(item => {
        const itemEl = renderHistoryItem(item, 0, history, listContainer, filterText);
        listContainer.appendChild(itemEl);
      });
    }

    panel.classList.add('active');
  }

  /**
   * 清除所有历史记录
   */
  function clearAll() {
    store.set('history', []);
  }

  return {
    showPanel,
    clearAll
  };
}

module.exports = {
  createHistoryPanelManager
};
