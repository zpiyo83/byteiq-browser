function createDownloadsManager(options) {
  const {
    clipboard,
    downloadsClearAllBtn,
    downloadsClearCompletedBtn,
    downloadsClearFailedBtn,
    downloadsFilters,
    downloadsList,
    downloadsPanel,
    downloadsSearchInput,
    ipcRenderer,
    openDownloadPath,
    openOverlay,
    showToast,
    store,
    t
  } = options;

  let downloadsRaf = null;

  function updateDownloadStore(data) {
    let downloads = store.get('downloads', []);
    const downloadId = data.id || '';
    const index = downloadId
      ? downloads.findIndex((item) => item.id === downloadId)
      : downloads.findIndex((item) => item.fileName === data.fileName);
    const current = index > -1 ? downloads[index] : {};

    const now = Date.now();
    const lastUpdateAt = current.lastUpdateAt || 0;
    const lastReceived = current.lastReceived || 0;
    const received =
      data.received !== undefined ? data.received : current.received || 0;
    const total = data.total !== undefined ? data.total : current.total || 0;

    let speedBps = current.speedBps || 0;
    let etaSeconds = current.etaSeconds || 0;
    if (
      data.state === 'progressing' &&
      received >= 0 &&
      total > 0 &&
      lastUpdateAt > 0 &&
      now > lastUpdateAt
    ) {
      const deltaBytes = Math.max(0, received - lastReceived);
      const deltaSeconds = Math.max(0.001, (now - lastUpdateAt) / 1000);
      const instant = deltaBytes / deltaSeconds;
      speedBps = speedBps ? speedBps * 0.75 + instant * 0.25 : instant;
      const remaining = Math.max(0, total - received);
      etaSeconds = speedBps > 1 ? Math.round(remaining / speedBps) : 0;
    }

    const nextItem = {
      id: downloadId || current.id || '',
      fileName: data.fileName,
      received,
      total,
      state: data.state || current.state || 'progressing',
      error: data.error || '',
      savePath: data.savePath || current.savePath || '',
      url: data.url || current.url || '',
      mimeType: data.mimeType || current.mimeType || '',
      paused:
        data.paused !== undefined ? data.paused : current.paused || false,
      speedBps,
      etaSeconds,
      lastUpdateAt: now,
      lastReceived: received,
      time: current.time || new Date().toISOString()
    };

    if (index > -1) {
      downloads[index] = nextItem;
    } else {
      downloads.unshift(nextItem);
    }

    if (downloads.length > 200) {
      downloads = downloads.slice(0, 200);
    }

    store.set('downloads', downloads);
  }

  function formatDownloadTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) {
      return t('time.justNow') || '刚刚';
    }

    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `${mins}${t('time.minutesAgo') || '分钟前'}`;
    }

    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}${t('time.hoursAgo') || '小时前'}`;
    }

    return (
      date.toLocaleDateString() +
      ' ' +
      date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  }

  function updateDownloadsFilterUI() {
    if (!downloadsFilters) return;
    const active = store.get('ui.downloadsFilter', 'all');
    downloadsFilters.querySelectorAll('.filter-btn').forEach((btn) => {
      const key = btn.getAttribute('data-filter') || 'all';
      btn.classList.toggle('active', key === active);
    });
  }

  function createIconButton(className, iconSvg, titleText, clickHandler) {
    const btn = document.createElement('button');
    btn.className = className + ' icon-btn';
    btn.innerHTML = iconSvg;
    btn.title = titleText;
    btn.addEventListener('click', clickHandler);
    return btn;
  }

  function renderDownloadsPanel() {
    const downloads = store.get('downloads', []);
    const query = (downloadsSearchInput?.value || '').trim().toLowerCase();
    const activeFilter = store.get('ui.downloadsFilter', 'all');

    const sortedDownloads = [...downloads].sort((a, b) => {
      const aProgressing = a.state === 'progressing';
      const bProgressing = b.state === 'progressing';
      if (aProgressing && !bProgressing) return -1;
      if (!aProgressing && bProgressing) return 1;
      return new Date(b.time || 0) - new Date(a.time || 0);
    });

    const filtered = sortedDownloads.filter((item) => {
      if (activeFilter && activeFilter !== 'all') {
        const state = item.state || '';
        if (activeFilter === 'failed') {
          if (
            state !== 'failed' &&
            state !== 'cancelled' &&
            state !== 'interrupted'
          ) {
            return false;
          }
        } else if (state !== activeFilter) {
          return false;
        }
      }
      if (!query) return true;
      const name = (item.fileName || '').toLowerCase();
      const url = (item.url || '').toLowerCase();
      const path = (item.savePath || '').toLowerCase();
      return name.includes(query) || url.includes(query) || path.includes(query);
    });
    downloadsList.innerHTML = '';

    if (filtered.length === 0) {
      downloadsList.innerHTML =
        `<p style="text-align:center;color:#999;padding:20px;">` +
        `${t('panels.downloads.empty')}</p>`;
      return;
    }

    const icons = {
      copy:
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
        '<path fill="currentColor" d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z"/>' +
        '</svg>',
      pause:
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
        '<path fill="currentColor" d="M14,19H18V5H14M6,19H10V5H6V19Z"/>' +
        '</svg>',
      resume:
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
        '<path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z"/>' +
        '</svg>',
      cancel:
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
        '<path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>' +
        '</svg>',
      retry:
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
        '<path fill="currentColor" d="M17.65,6.35C16.2,4.9,14.21,4,12,4c-4.42,0-7.99,3.58-7.99,8s3.57,8,7.99,8c3.73,0,6.84-2.55,7.73-6h-2.08c-0.82,2.33-3.07,4-5.65,4c-3.31,0-6-2.69-6-6s2.69-6,6-6c1.66,0,3.14,0.69,4.22,1.78L13,11h7V4L17.65,6.35z"/>' +
        '</svg>',
      openFile:
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
        '<path fill="currentColor" d="M19,20H4C2.89,20 2,19.1 2,18V6C2,4.89 2.89,4 4,4H10L12,6H19A2,2 0 0,1 21,8H21L4,8V18L6.14,10H23.21L20.93,18.5C20.7,19.37 19.92,20 19,20Z"/>' +
        '</svg>',
      showInFolder:
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
        '<path fill="currentColor" d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4M13,10H15V13H18V15H15V18H13V15H10V13H13V10Z"/>' +
        '</svg>',
      delete:
        '<svg viewBox="0 0 24 24" width="14" height="14">' +
        '<path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>' +
        '</svg>'
    };

    filtered.forEach((item) => {
      const index = downloads.indexOf(item);
      const itemEl = document.createElement('div');
      itemEl.className = 'list-item download-item';

      const content = document.createElement('div');
      content.className = 'download-content';

      const fileInfo = document.createElement('div');
      fileInfo.className = 'download-file-info';

      const fileName = document.createElement('span');
      fileName.className = 'download-filename';
      fileName.innerText = item.fileName || 'Unknown';
      fileInfo.appendChild(fileName);

      if (item.savePath) {
        const pathEl = document.createElement('span');
        pathEl.className = 'download-path';
        pathEl.innerText = item.savePath;
        fileInfo.appendChild(pathEl);
      }
      content.appendChild(fileInfo);

      if (item.state === 'progressing' && item.total > 0) {
        const percent = Math.round((item.received / item.total) * 100);
        const progress = document.createElement('progress');
        progress.value = percent;
        progress.max = 100;
        progress.className = 'download-progress';
        content.appendChild(progress);

        const detail = document.createElement('div');
        detail.className = 'download-detail';
        detail.innerText = t('status.downloadProgress', {
          percent,
          received: (item.received / 1024 / 1024).toFixed(2),
          total: (item.total / 1024 / 1024).toFixed(2)
        });
        content.appendChild(detail);

        const meta = document.createElement('div');
        meta.className = 'download-meta';
        const speedText = item.speedBps
          ? `${(item.speedBps / 1024 / 1024).toFixed(2)} MB/s`
          : '';
        const etaText = item.etaSeconds ? `${item.etaSeconds}s` : '';
        const pausedText = item.paused ? t('status.paused') : '';
        meta.innerText = [speedText, etaText, pausedText]
          .filter(Boolean)
          .join(' | ');
        if (meta.innerText) {
          content.appendChild(meta);
        }
      } else {
        const stateInfo = document.createElement('div');
        stateInfo.className = 'download-state-info';

        if (item.state === 'completed') {
          stateInfo.className += ' state-completed';
          stateInfo.innerText = t('status.downloadComplete');
          if (item.time) {
            const timeStr = formatDownloadTime(item.time);
            const timeEl = document.createElement('span');
            timeEl.className = 'download-time';
            timeEl.innerText = t('status.completedAt', { time: timeStr });
            stateInfo.appendChild(document.createElement('br'));
            stateInfo.appendChild(timeEl);
          }
        } else if (item.state === 'cancelled') {
          stateInfo.className += ' state-cancelled';
          stateInfo.innerText = t('status.downloadCancelled');
        } else if (item.state === 'interrupted') {
          stateInfo.className += ' state-interrupted';
          stateInfo.innerText = t('status.downloadInterrupted');
        } else if (item.state === 'failed') {
          stateInfo.className += ' state-failed';
          const err = item.error || 'unknown';
          stateInfo.innerText = t('status.downloadFailed', { error: err });
        } else {
          stateInfo.innerText = item.state;
        }

        content.appendChild(stateInfo);
      }

      if (item.url) {
        const urlEl = document.createElement('div');
        urlEl.className = 'download-url';
        urlEl.innerText = item.url;
        content.appendChild(urlEl);
      }

      const actions = document.createElement('div');
      actions.className = 'download-actions';

      if (item.savePath) {
        const copyPathBtn = createIconButton(
          'download-copy-path-btn',
          icons.copy,
          t('panels.downloads.copyPath'),
          () => {
            clipboard.writeText(item.savePath);
          }
        );
        actions.appendChild(copyPathBtn);
      }

      if (item.url) {
        const copyUrlBtn = createIconButton(
          'download-copy-url-btn',
          icons.copy,
          t('panels.downloads.copyUrl'),
          () => {
            clipboard.writeText(item.url);
          }
        );
        actions.appendChild(copyUrlBtn);
      }

      if (item.state === 'progressing' && item.id) {
        if (item.paused) {
          const resumeBtn = createIconButton(
            'download-resume-btn',
            icons.resume,
            t('panels.downloads.resume'),
            () => {
              ipcRenderer.send('download-resume', item.id);
            }
          );
          actions.appendChild(resumeBtn);
        } else {
          const pauseBtn = createIconButton(
            'download-pause-btn',
            icons.pause,
            t('panels.downloads.pause'),
            () => {
              ipcRenderer.send('download-pause', item.id);
            }
          );
          actions.appendChild(pauseBtn);
        }

        const cancelBtn = createIconButton(
          'download-cancel-btn',
          icons.cancel,
          t('panels.downloads.cancel'),
          () => {
            ipcRenderer.send('download-cancel', item.id);
          }
        );
        actions.appendChild(cancelBtn);
      }

      if (item.state === 'failed' && item.url) {
        const retryBtn = createIconButton(
          'download-retry-btn',
          icons.retry,
          t('panels.downloads.retry'),
          () => {
            ipcRenderer.send('download-retry', item.url);
          }
        );
        actions.appendChild(retryBtn);
      }

      if (item.state === 'completed' && item.savePath) {
        const openFileBtn = createIconButton(
          'download-open-file-btn',
          icons.openFile,
          t('panels.downloads.openFile'),
          () => {
            ipcRenderer.send('open-download-file', item.savePath);
          }
        );
        actions.appendChild(openFileBtn);
      }

      if (item.savePath) {
        const openBtn = createIconButton(
          'download-open-btn',
          icons.showInFolder,
          t('panels.downloads.showInFolder'),
          () => {
            openDownloadPath(item.savePath);
          }
        );
        actions.appendChild(openBtn);
      }

      const deleteBtn = createIconButton(
        'download-delete-btn',
        icons.delete,
        t('delete'),
        () => {
          const nextDownloads = store.get('downloads', []);
          nextDownloads.splice(index, 1);
          store.set('downloads', nextDownloads);
          renderDownloadsPanel();
        }
      );
      actions.appendChild(deleteBtn);

      itemEl.appendChild(content);
      itemEl.appendChild(actions);
      downloadsList.appendChild(itemEl);
    });
  }

  function openDownloadsPanel() {
    updateDownloadsFilterUI();
    renderDownloadsPanel();
    openOverlay(downloadsPanel);
  }

  function bindEvents() {
    if (downloadsClearAllBtn) {
      downloadsClearAllBtn.addEventListener('click', () => {
        const msg = t('panels.downloads.clearAllConfirm') || 'Clear all downloads?';
        if (!confirm(msg)) return;
        store.set('downloads', []);
        renderDownloadsPanel();
      });
    }

    if (downloadsClearCompletedBtn) {
      downloadsClearCompletedBtn.addEventListener('click', () => {
        const downloads = store.get('downloads', []);
        const filtered = downloads.filter((item) => item.state !== 'completed');
        if (filtered.length === downloads.length) {
          return;
        }
        store.set('downloads', filtered);
        renderDownloadsPanel();
      });
    }

    if (downloadsClearFailedBtn) {
      downloadsClearFailedBtn.addEventListener('click', () => {
        const downloads = store.get('downloads', []);
        const filtered = downloads.filter((item) => {
          const state = item.state || '';
          return (
            state !== 'failed' &&
            state !== 'cancelled' &&
            state !== 'interrupted'
          );
        });
        if (filtered.length === downloads.length) {
          return;
        }
        store.set('downloads', filtered);
        renderDownloadsPanel();
      });
    }

    if (downloadsFilters) {
      downloadsFilters.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        const key = btn.getAttribute('data-filter') || 'all';
        store.set('ui.downloadsFilter', key);
        updateDownloadsFilterUI();
        renderDownloadsPanel();
      });
    }

    if (downloadsSearchInput) {
      downloadsSearchInput.addEventListener('input', () => {
        renderDownloadsPanel();
      });
    }

    ipcRenderer.on('download-progress', (event, data) => {
      const prevState = store
        .get('downloads', [])
        .find((item) => item.id === data.id)?.state;
      updateDownloadStore(data);

      if (data.state === 'completed' && prevState !== 'completed') {
        showToast(
          t('toast.downloadComplete') || `下载完成: ${data.fileName}`,
          'success'
        );
      } else if (data.state === 'failed' && prevState !== 'failed') {
        showToast(t('toast.downloadFailed') || `下载失败: ${data.fileName}`, 'error');
      } else if (data.state === 'cancelled' && prevState !== 'cancelled') {
        showToast(
          t('toast.downloadCancelled') || `下载已取消: ${data.fileName}`,
          'warning'
        );
      }

      if (!downloadsPanel.classList.contains('active')) return;
      if (downloadsRaf) return;
      downloadsRaf = requestAnimationFrame(() => {
        downloadsRaf = null;
        updateDownloadsFilterUI();
        renderDownloadsPanel();
      });
    });
  }

  return {
    bindEvents,
    openDownloadsPanel,
    renderDownloadsPanel,
    updateDownloadsFilterUI
  };
}

module.exports = {
  createDownloadsManager
};
