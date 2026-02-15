function createExtensionsManager(options) {
  const {
    documentRef,
    ipcRenderer,
    modalManager,
    showToast,
    listEl,
    addBtn,
    refreshBtn,
    emptyEl
  } = options;

  let extensions = [];

  function clearList() {
    if (!listEl) return;
    while (listEl.firstChild) {
      listEl.removeChild(listEl.firstChild);
    }
  }

  function setEmptyVisible(visible) {
    if (!emptyEl) return;
    emptyEl.style.display = visible ? 'block' : 'none';
  }

  function buildExtensionItem(ext) {
    const item = documentRef.createElement('div');
    item.className = 'extension-item';

    const info = documentRef.createElement('div');
    info.className = 'extension-info';

    const title = documentRef.createElement('div');
    title.className = 'extension-title';

    const name = documentRef.createElement('span');
    name.className = 'extension-name';
    name.textContent = ext.name || '\u672a\u547d\u540d\u6269\u5c55';

    const version = documentRef.createElement('span');
    version.className = 'extension-version';
    version.textContent = ext.version ? `v${ext.version}` : '\u672a\u77e5\u7248\u672c';

    title.appendChild(name);
    title.appendChild(version);

    const meta = documentRef.createElement('div');
    meta.className = 'extension-meta';

    const idLine = documentRef.createElement('span');
    idLine.className = 'extension-id';
    idLine.textContent = ext.id ? `ID: ${ext.id}` : 'ID: \u672a\u751f\u6210';

    const pathLine = documentRef.createElement('span');
    pathLine.className = 'extension-path';
    pathLine.textContent = ext.path || '';
    pathLine.title = ext.path || '';

    meta.appendChild(idLine);
    meta.appendChild(pathLine);

    info.appendChild(title);
    info.appendChild(meta);

    if (ext.lastError) {
      const error = documentRef.createElement('div');
      error.className = 'extension-error';
      error.textContent = ext.lastError;
      info.appendChild(error);
    }

    const actions = documentRef.createElement('div');
    actions.className = 'extension-actions';

    const status = documentRef.createElement('span');
    status.className = 'extension-status';
    status.textContent = ext.enabled ? '\u5df2\u542f\u7528' : '\u5df2\u505c\u7528';

    const toggleLabel = documentRef.createElement('label');
    toggleLabel.className = 'toggle-switch';
    const toggle = documentRef.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = !!ext.enabled;
    const slider = documentRef.createElement('span');
    slider.className = 'toggle-slider';
    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(slider);

    const removeBtn = documentRef.createElement('button');
    removeBtn.className = 'setting-action-btn danger extension-remove-btn';
    removeBtn.textContent = '\u79fb\u9664';

    const openPopupBtn = documentRef.createElement('button');
    openPopupBtn.className = 'setting-action-btn extension-open-btn';
    openPopupBtn.textContent = '\u6253\u5f00\u5f39\u7a97';

    const openOptionsBtn = documentRef.createElement('button');
    openOptionsBtn.className = 'setting-action-btn extension-open-btn';
    openOptionsBtn.textContent = '\u6253\u5f00\u8bbe\u7f6e';

    const detailBtn = documentRef.createElement('button');
    detailBtn.className = 'setting-action-btn extension-detail-btn';
    detailBtn.textContent = '\u8be6\u60c5';

    actions.appendChild(status);
    actions.appendChild(toggleLabel);
    actions.appendChild(detailBtn);
    if (ext.popup) {
      actions.appendChild(openPopupBtn);
    }
    if (ext.options) {
      actions.appendChild(openOptionsBtn);
    }
    actions.appendChild(removeBtn);

    item.appendChild(info);
    item.appendChild(actions);

    toggle.addEventListener('change', async () => {
      toggle.disabled = true;
      const enabled = toggle.checked;
      const result = await ipcRenderer.invoke('extensions-set-enabled', {
        path: ext.path,
        enabled
      });

      if (!result || !result.ok) {
        toggle.checked = !enabled;
        if (result && result.message) {
          showToast(result.message, 'error');
        }
      } else {
        await refresh();
      }

      toggle.disabled = false;
    });

    if (ext.popup) {
      openPopupBtn.addEventListener('click', async () => {
        const result = await ipcRenderer.invoke('extensions-open-page', {
          path: ext.path,
          page: 'popup'
        });
        if (!result || !result.ok) {
          modalManager.error(result && result.message ? result.message : '\u65e0\u6cd5\u6253\u5f00\u5f39\u7a97');
        }
      });
    }

    if (ext.options) {
      openOptionsBtn.addEventListener('click', async () => {
        const result = await ipcRenderer.invoke('extensions-open-page', {
          path: ext.path,
          page: 'options'
        });
        if (!result || !result.ok) {
          modalManager.error(result && result.message ? result.message : '\u65e0\u6cd5\u6253\u5f00\u8bbe\u7f6e');
        }
      });
    }

    detailBtn.addEventListener('click', async () => {
      const result = await ipcRenderer.invoke('extensions-details', {
        path: ext.path
      });
      if (!result || !result.ok) {
        modalManager.error(result && result.message ? result.message : '\u65e0\u6cd5\u83b7\u53d6\u8be6\u60c5');
        return;
      }

      const details = result.details || {};
      const logs = Array.isArray(result.logs) ? result.logs : [];
      const lines = [];

      lines.push(`\u540d\u79f0: ${details.name || '-'}`);
      lines.push(`ID: ${details.id || '-'}`);
      lines.push(`\u7248\u672c: ${details.version || '-'}`);
      lines.push(`\u72b6\u6001: ${details.enabled ? '\u5df2\u542f\u7528' : '\u5df2\u505c\u7528'}`);
      lines.push(`\u8def\u5f84: ${details.path || '-'}`);
      lines.push(`manifest_version: ${details.manifestVersion || '-'}`);
      if (details.defaultLocale) {
        lines.push(`default_locale: ${details.defaultLocale}`);
      }
      if (details.popup) {
        lines.push(`popup: ${details.popup}`);
      }
      if (details.options) {
        lines.push(`options: ${details.options}`);
      }
      if (details.background) {
        lines.push(`background: ${details.background}`);
      }
      if (details.permissions && details.permissions.length) {
        lines.push(`permissions: ${details.permissions.join(', ')}`);
      }
      if (details.hostPermissions && details.hostPermissions.length) {
        lines.push(`host_permissions: ${details.hostPermissions.join(', ')}`);
      }
      if (details.contentScripts && details.contentScripts.length) {
        const scripts = details.contentScripts.map((item) => {
          const matches = Array.isArray(item.matches) ? item.matches.join(', ') : '';
          const js = Array.isArray(item.js) ? item.js.join(', ') : '';
          return `content_script matches=[${matches}] js=[${js}] run_at=${item.run_at || ''}`;
        });
        lines.push('\u5185\u5bb9\u811a\u672c:');
        scripts.forEach((line) => lines.push(`  - ${line}`));
      }
      if (details.lastError) {
        lines.push(`\u6700\u8fd1\u9519\u8bef: ${details.lastError}`);
      }

      if (details.permissions && details.permissions.length) {
        const needs = details.permissions.filter((p) => {
          return p === 'sidePanel' || p === 'offscreen';
        });
        if (needs.length) {
          lines.push(`\u63d0\u793a: \u68c0\u6d4b\u5230\u6743\u9650 ${needs.join(', ')} \uff0cElectron \u4e2d\u53ef\u80fd\u4e0d\u5b8c\u6574\u652f\u6301`);
        }
      }

      lines.push('');
      lines.push('\u8fd1\u671f\u65e5\u5fd7:');
      if (logs.length === 0) {
        lines.push('  (\u6682\u65e0)');
      } else {
        logs.forEach((log) => {
          const time = log.time || '';
          const level = log.level || 'info';
          const msg = log.message || '';
          const detail = log.detail ? ` ${log.detail}` : '';
          lines.push(`  [${time}] ${level}: ${msg}${detail}`);
        });
      }

      modalManager.show({
        type: 'info',
        title: '\u6269\u5c55\u8be6\u60c5',
        message: lines.join('\\n')
      });
    });

    removeBtn.addEventListener('click', async () => {
      const confirmed = await modalManager.confirmDelete(
        '\u786e\u5b9a\u8981\u79fb\u9664\u8be5\u6269\u5c55\u5417\uff1f',
        '\u79fb\u9664\u6269\u5c55'
      );
      if (!confirmed) return;

      const result = await ipcRenderer.invoke('extensions-remove', {
        path: ext.path
      });
      if (!result || !result.ok) {
        modalManager.error(result && result.message ? result.message : '\u79fb\u9664\u5931\u8d25');
        return;
      }

      showToast('\u6269\u5c55\u5df2\u79fb\u9664', 'success');
      await refresh();
    });

    return item;
  }

  function render() {
    if (!listEl) return;
    clearList();

    if (!extensions.length) {
      setEmptyVisible(true);
      return;
    }

    setEmptyVisible(false);
    extensions.forEach((ext) => {
      const item = buildExtensionItem(ext);
      listEl.appendChild(item);
    });
  }

  async function refresh() {
    if (!listEl) return;
    const result = await ipcRenderer.invoke('extensions-list');
    if (!result || result.ok === false) {
      showToast(result && result.message ? result.message : '\u52a0\u8f7d\u6269\u5c55\u5931\u8d25', 'error');
      return;
    }

    const list = Array.isArray(result.extensions) ? result.extensions : [];
    extensions = list;
    render();
  }

  async function handleAddExtension() {
    const picker = await ipcRenderer.invoke('extensions-choose-folder');
    if (!picker || picker.canceled) return;

    const result = await ipcRenderer.invoke('extensions-add', {
      path: picker.path
    });

    if (!result || !result.ok) {
      modalManager.error(result && result.message ? result.message : '\u6dfb\u52a0\u5931\u8d25');
      return;
    }

    showToast('\u6269\u5c55\u5df2\u6dfb\u52a0', 'success');
    await refresh();
  }

  function bindEvents() {
    if (addBtn) {
      addBtn.addEventListener('click', handleAddExtension);
    }
    if (refreshBtn) {
      refreshBtn.addEventListener('click', refresh);
    }
  }

  function init() {
    bindEvents();
    refresh();
  }

  return {
    init,
    refresh
  };
}

module.exports = {
  createExtensionsManager
};
