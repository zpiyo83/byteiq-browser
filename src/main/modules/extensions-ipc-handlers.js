function registerExtensionIpcHandlers(context) {
  const {
    BrowserWindow,
    appendExtensionLog,
    buildExtensionDetails,
    dialog,
    extractExtensionIdFromSource,
    findExtensionIndexByPath,
    getExtensionById,
    getExtensionLogs,
    getExtensionPageUrl,
    getLoadedExtensionByPath,
    getStoredExtensions,
    getTargetSession,
    ipcMain,
    loadExtensionByPath,
    normalizeExtensionPath,
    readExtensionManifest,
    resolveMainWindow,
    saveStoredExtensions,
    getExtensionUiInfo
  } = context;

  ipcMain.handle('extensions-list', () => {
    const list = getStoredExtensions();
    const enriched = list.map(item => {
      if (!item || !item.path) return item;
      const resolvedPath = normalizeExtensionPath(item.path);
      const manifest = readExtensionManifest(resolvedPath);
      const uiInfo = getExtensionUiInfo(manifest);
      return {
        ...item,
        path: resolvedPath,
        popup: uiInfo.popup,
        options: uiInfo.options,
        manifestVersion: uiInfo.manifestVersion
      };
    });
    saveStoredExtensions(enriched);
    return {
      ok: true,
      extensions: enriched
    };
  });

  ipcMain.handle('extensions-details', (event, { path: extPath }) => {
    if (!extPath) {
      return { ok: false, message: '扩展路径无效' };
    }

    const resolvedPath = normalizeExtensionPath(extPath);
    const list = getStoredExtensions();
    const index = findExtensionIndexByPath(list, resolvedPath);
    const entry = index === -1 ? null : list[index];

    const details = buildExtensionDetails(resolvedPath, entry);
    const logs = getExtensionLogs(resolvedPath);

    return {
      ok: true,
      details,
      logs
    };
  });

  ipcMain.on('extensions-log', (event, payload) => {
    if (!payload) return;
    const { extensionId, sourceId, level, message, detail } = payload;

    const id = extensionId || extractExtensionIdFromSource(sourceId);
    const ext = id ? getExtensionById(id) : null;

    if (ext && ext.path) {
      appendExtensionLog(ext.path, level, message, detail || sourceId || '');
      return;
    }

    if (sourceId) {
      const extracted = extractExtensionIdFromSource(sourceId);
      const extractedExt = extracted ? getExtensionById(extracted) : null;
      if (extractedExt && extractedExt.path) {
        appendExtensionLog(extractedExt.path, level, message, detail || sourceId || '');
      }
    }
  });

  ipcMain.handle('extensions-choose-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择扩展目录'
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return {
      canceled: false,
      path: result.filePaths[0]
    };
  });

  ipcMain.handle('extensions-add', async (event, { path: extPath }) => {
    if (!extPath) {
      return { ok: false, message: '扩展路径无效' };
    }

    const resolvedPath = normalizeExtensionPath(extPath);
    const manifest = readExtensionManifest(resolvedPath);
    if (!manifest) {
      return { ok: false, message: '读取 manifest.json 失败' };
    }
    const uiInfo = getExtensionUiInfo(manifest);

    const list = getStoredExtensions();
    const index = findExtensionIndexByPath(list, resolvedPath);
    const targetSession = getTargetSession();
    const existing = getLoadedExtensionByPath(targetSession, resolvedPath);

    if (existing) {
      appendExtensionLog(resolvedPath, 'info', 'Extension already loaded', existing.id);
      const entry = {
        path: resolvedPath,
        enabled: true,
        id: existing.id,
        name: existing.name,
        version: existing.version,
        popup: uiInfo.popup,
        options: uiInfo.options,
        manifestVersion: uiInfo.manifestVersion,
        lastError: ''
      };
      if (index >= 0) {
        list[index] = { ...list[index], ...entry };
      } else {
        list.push(entry);
      }
      saveStoredExtensions(list);
      return { ok: true, extension: entry, extensions: list };
    }

    try {
      const extension = await loadExtensionByPath(resolvedPath);
      appendExtensionLog(resolvedPath, 'info', 'Extension loaded', extension.id);
      const entry = {
        path: resolvedPath,
        enabled: true,
        id: extension.id,
        name: extension.name,
        version: extension.version,
        popup: uiInfo.popup,
        options: uiInfo.options,
        manifestVersion: uiInfo.manifestVersion,
        lastError: ''
      };

      if (index >= 0) {
        list[index] = { ...list[index], ...entry };
      } else {
        list.push(entry);
      }

      saveStoredExtensions(list);
      return { ok: true, extension: entry, extensions: list };
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      appendExtensionLog(resolvedPath, 'error', 'Extension load failed', message);
      if (index >= 0) {
        list[index] = {
          ...list[index],
          path: resolvedPath,
          enabled: false,
          lastError: message
        };
        saveStoredExtensions(list);
      }
      return { ok: false, message: `加载扩展失败：${message}` };
    }
  });

  ipcMain.handle('extensions-set-enabled', async (event, { path: extPath, enabled }) => {
    if (!extPath) {
      return { ok: false, message: '扩展路径无效' };
    }

    const resolvedPath = normalizeExtensionPath(extPath);
    const list = getStoredExtensions();
    const index = findExtensionIndexByPath(list, resolvedPath);

    if (index === -1) {
      return { ok: false, message: '未找到扩展记录' };
    }

    const targetSession = getTargetSession();
    const current = list[index];

    if (enabled) {
      try {
        const existing = getLoadedExtensionByPath(targetSession, resolvedPath);
        const extension = existing || (await loadExtensionByPath(resolvedPath));
        appendExtensionLog(resolvedPath, 'info', 'Extension enabled', extension.id);
        const manifest = readExtensionManifest(resolvedPath);
        const uiInfo = getExtensionUiInfo(manifest);
        list[index] = {
          ...current,
          path: resolvedPath,
          enabled: true,
          id: extension.id,
          name: extension.name,
          version: extension.version,
          popup: uiInfo.popup,
          options: uiInfo.options,
          manifestVersion: uiInfo.manifestVersion,
          lastError: ''
        };
        saveStoredExtensions(list);
        return { ok: true, extensions: list };
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        appendExtensionLog(resolvedPath, 'error', 'Extension enable failed', message);
        list[index] = {
          ...current,
          enabled: false,
          lastError: message
        };
        saveStoredExtensions(list);
        return { ok: false, message: `启用扩展失败：${message}` };
      }
    }

    try {
      const loaded = current.id ? targetSession.getExtension(current.id) : null;
      const matched = loaded || getLoadedExtensionByPath(targetSession, resolvedPath);
      if (matched) {
        targetSession.removeExtension(matched.id);
      }
      appendExtensionLog(resolvedPath, 'info', 'Extension disabled');
      list[index] = {
        ...current,
        enabled: false,
        lastError: ''
      };
      saveStoredExtensions(list);
      return { ok: true, extensions: list };
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      return { ok: false, message: `停用扩展失败：${message}` };
    }
  });

  ipcMain.handle('extensions-open-page', async (event, { path: extPath, page }) => {
    if (!extPath) {
      return { ok: false, message: '扩展路径无效' };
    }

    const resolvedPath = normalizeExtensionPath(extPath);
    const list = getStoredExtensions();
    const index = findExtensionIndexByPath(list, resolvedPath);
    const current = index === -1 ? null : list[index];

    if (current && current.enabled === false) {
      return { ok: false, message: '请先启用该扩展' };
    }

    const manifest = readExtensionManifest(resolvedPath);
    if (!manifest) {
      return { ok: false, message: '读取 manifest.json 失败' };
    }

    const uiInfo = getExtensionUiInfo(manifest);
    let pagePath = '';
    if (page === 'popup') {
      pagePath = uiInfo.popup;
    } else if (page === 'options') {
      pagePath = uiInfo.options;
    } else if (page) {
      pagePath = String(page);
    }

    if (!pagePath) {
      return { ok: false, message: '该扩展没有可打开的页面' };
    }

    const targetSession = getTargetSession();
    let extension = getLoadedExtensionByPath(targetSession, resolvedPath);

    if (!extension) {
      try {
        extension = await loadExtensionByPath(resolvedPath);
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        return { ok: false, message: `加载扩展失败：${message}` };
      }
    }

    if (!extension) {
      return { ok: false, message: '扩展未启用' };
    }

    const url = getExtensionPageUrl(extension.id, pagePath);
    const name = extension.name || manifest.name || 'Extension';
    const isPopup = page === 'popup';
    const windowTitle = isPopup ? `${name} - Popup` : `${name} - Options`;
    const size = isPopup ? { width: 420, height: 640 } : { width: 980, height: 720 };

    const win = new BrowserWindow({
      ...size,
      parent: resolveMainWindow() || undefined,
      modal: false,
      show: false,
      title: windowTitle,
      webPreferences: {
        session: targetSession,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    win.loadURL(url);
    appendExtensionLog(resolvedPath, 'info', 'open-page', url);
    win.webContents.on('did-start-loading', () => {
      appendExtensionLog(resolvedPath, 'info', 'did-start-loading', url);
    });
    win.webContents.on('dom-ready', () => {
      appendExtensionLog(resolvedPath, 'info', 'dom-ready', url);
    });
    win.webContents.on('did-finish-load', () => {
      appendExtensionLog(resolvedPath, 'info', 'did-finish-load', url);
    });
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      const levelMap = {
        0: 'log',
        1: 'warn',
        2: 'error',
        3: 'info'
      };
      const label = levelMap[level] || 'log';
      const detail = sourceId ? `${sourceId}:${line}` : '';
      appendExtensionLog(resolvedPath, label, message, detail);
    });
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      const detail = validatedURL ? `url=${validatedURL}` : '';
      appendExtensionLog(
        resolvedPath,
        'error',
        `did-fail-load(${errorCode}) ${errorDescription}`,
        detail
      );
    });
    win.webContents.on('render-process-gone', (event, details) => {
      appendExtensionLog(
        resolvedPath,
        'error',
        'render-process-gone',
        JSON.stringify(details || {})
      );
    });
    win.webContents.on('unresponsive', () => {
      appendExtensionLog(resolvedPath, 'warn', 'unresponsive');
    });
    win.webContents.on('responsive', () => {
      appendExtensionLog(resolvedPath, 'info', 'responsive');
    });
    win.once('ready-to-show', () => {
      win.show();
    });

    return { ok: true };
  });

  ipcMain.handle('extensions-remove', async (event, { path: extPath }) => {
    if (!extPath) {
      return { ok: false, message: '扩展路径无效' };
    }

    const resolvedPath = normalizeExtensionPath(extPath);
    const list = getStoredExtensions();
    const index = findExtensionIndexByPath(list, resolvedPath);

    if (index === -1) {
      return { ok: false, message: '未找到扩展记录' };
    }

    const targetSession = getTargetSession();
    const current = list[index];

    try {
      const loaded = current.id ? targetSession.getExtension(current.id) : null;
      const matched = loaded || getLoadedExtensionByPath(targetSession, resolvedPath);
      if (matched) {
        targetSession.removeExtension(matched.id);
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      return { ok: false, message: `移除扩展失败：${message}` };
    }

    list.splice(index, 1);
    saveStoredExtensions(list);
    appendExtensionLog(resolvedPath, 'info', 'Extension removed');
    return { ok: true, extensions: list };
  });

  return {};
}

module.exports = {
  registerExtensionIpcHandlers
};
