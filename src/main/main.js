const { app, BrowserWindow, BrowserView, Menu, dialog, shell, ipcMain, session } = require('electron');
const fs = require('fs');
const path = require('path');
const Store = require('electron-store');

const store = new Store();
const EXTENSIONS_KEY = 'extensions';
const EXTENSION_LOG_LIMIT = 200;

let mainWindow;
let devtoolsView = null;
let devtoolsWebContentsId = null;

let downloadSeq = 0;
const downloadItemsById = new Map();
const extensionLogsByPath = new Map();

function appendExtensionLog(extPath, level, message, detail = '') {
  if (!extPath) return;
  const resolvedPath = normalizeExtensionPath(extPath);
  const list = extensionLogsByPath.get(resolvedPath) || [];
  const entry = {
    time: new Date().toISOString(),
    level: level || 'info',
    message: message || '',
    detail: detail || ''
  };
  list.push(entry);
  if (list.length > EXTENSION_LOG_LIMIT) {
    list.splice(0, list.length - EXTENSION_LOG_LIMIT);
  }
  extensionLogsByPath.set(resolvedPath, list);
}

function getExtensionLogs(extPath) {
  if (!extPath) return [];
  const resolvedPath = normalizeExtensionPath(extPath);
  return extensionLogsByPath.get(resolvedPath) || [];
}

function getStoredExtensions() {
  const list = store.get(EXTENSIONS_KEY, []);
  return Array.isArray(list) ? list : [];
}

function saveStoredExtensions(list) {
  store.set(EXTENSIONS_KEY, list);
  return list;
}

function normalizeExtensionPath(extPath) {
  return path.resolve(extPath);
}

function readExtensionManifest(extPath) {
  const manifestPath = path.join(extPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to read manifest:', manifestPath, error);
    return null;
  }
}

function getExtensionUiInfo(manifest) {
  if (!manifest) {
    return {
      popup: '',
      options: '',
      manifestVersion: null
    };
  }

  const popup = (manifest.action && manifest.action.default_popup)
    || (manifest.browser_action && manifest.browser_action.default_popup)
    || '';
  const options = manifest.options_page
    || (manifest.options_ui && manifest.options_ui.page)
    || '';

  return {
    popup,
    options,
    manifestVersion: manifest.manifest_version || null
  };
}

function getExtensionPageUrl(extensionId, pagePath) {
  if (!extensionId || !pagePath) return '';
  const normalized = String(pagePath).replace(/^\/+/, '');
  return `chrome-extension://${extensionId}/${normalized}`;
}

function getExtensionById(extensionId) {
  const targetSession = getTargetSession();
  if (!targetSession || !extensionId) return null;
  try {
    return targetSession.getExtension(extensionId) || null;
  } catch (error) {
    return null;
  }
}

function extractExtensionIdFromSource(sourceId) {
  if (!sourceId) return '';
  const match = String(sourceId).match(/^chrome-extension:\/\/([a-z0-9]{32})/i);
  return match ? match[1] : '';
}

function buildExtensionDetails(extPath, entry = null) {
  const resolvedPath = normalizeExtensionPath(extPath);
  const manifest = readExtensionManifest(resolvedPath);
  const uiInfo = getExtensionUiInfo(manifest);
  const name = (entry && entry.name) || (manifest && manifest.name) || '';
  const version = (entry && entry.version) || (manifest && manifest.version) || '';
  const id = entry && entry.id ? entry.id : '';
  const enabled = entry && typeof entry.enabled === 'boolean' ? entry.enabled : false;
  const lastError = entry && entry.lastError ? entry.lastError : '';

  const background = manifest && manifest.background
    ? (manifest.background.service_worker || manifest.background.page || '')
    : '';

  return {
    name,
    version,
    id,
    path: resolvedPath,
    enabled,
    lastError,
    manifestVersion: uiInfo.manifestVersion,
    popup: uiInfo.popup,
    options: uiInfo.options,
    defaultLocale: manifest && manifest.default_locale ? manifest.default_locale : '',
    permissions: Array.isArray(manifest && manifest.permissions)
      ? manifest.permissions
      : [],
    hostPermissions: Array.isArray(manifest && manifest.host_permissions)
      ? manifest.host_permissions
      : [],
    contentScripts: Array.isArray(manifest && manifest.content_scripts)
      ? manifest.content_scripts
      : [],
    background
  };
}

function findExtensionIndexByPath(list, extPath) {
  const normalized = normalizeExtensionPath(extPath);
  return list.findIndex((item) => {
    if (!item || !item.path) return false;
    return normalizeExtensionPath(item.path) === normalized;
  });
}

function getTargetSession() {
  if (mainWindow && mainWindow.webContents && mainWindow.webContents.session) {
    return mainWindow.webContents.session;
  }
  return session.defaultSession;
}

function getLoadedExtensionByPath(targetSession, extPath) {
  const normalized = normalizeExtensionPath(extPath);
  const all = targetSession.getAllExtensions();
  return Object.values(all).find((ext) => {
    return normalizeExtensionPath(ext.path) === normalized;
  }) || null;
}

async function loadExtensionByPath(extPath) {
  const targetSession = getTargetSession();
  return targetSession.loadExtension(extPath, {
    allowFileAccess: true
  });
}

async function loadEnabledExtensions() {
  const list = getStoredExtensions();
  const updated = [];

  for (const item of list) {
    if (!item || !item.enabled || !item.path) {
      if (item) updated.push(item);
      continue;
    }

    const resolvedPath = normalizeExtensionPath(item.path);
    const manifest = readExtensionManifest(resolvedPath);
    const uiInfo = getExtensionUiInfo(manifest);
    const targetSession = getTargetSession();
    const existing = getLoadedExtensionByPath(targetSession, resolvedPath);

    if (existing) {
      appendExtensionLog(resolvedPath, 'info', 'Extension already loaded', existing.id);
      updated.push({
        ...item,
        path: resolvedPath,
        id: existing.id,
        name: existing.name,
        version: existing.version,
        popup: uiInfo.popup,
        options: uiInfo.options,
        manifestVersion: uiInfo.manifestVersion,
        enabled: true,
        lastError: ''
      });
      continue;
    }

    try {
      const extension = await loadExtensionByPath(resolvedPath);
      appendExtensionLog(resolvedPath, 'info', 'Extension loaded', extension.id);
      updated.push({
        ...item,
        path: resolvedPath,
        id: extension.id,
        name: extension.name,
        version: extension.version,
        popup: uiInfo.popup,
        options: uiInfo.options,
        manifestVersion: uiInfo.manifestVersion,
        enabled: true,
        lastError: ''
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      appendExtensionLog(resolvedPath, 'error', 'Extension load failed', message);
      updated.push({
        ...item,
        path: resolvedPath,
        enabled: false,
        lastError: message
      });
    }
  }

  saveStoredExtensions(updated);
}

function attachExtensionListeners() {
  const targetSession = getTargetSession();
  if (!targetSession || targetSession.__extensionLoggingBound) return;
  targetSession.__extensionLoggingBound = true;

  targetSession.on('extension-loaded', (event, extension) => {
    appendExtensionLog(extension.path, 'info', 'extension-loaded', extension.id);
  });
  targetSession.on('extension-ready', (event, extension) => {
    appendExtensionLog(extension.path, 'info', 'extension-ready', extension.id);
  });
  targetSession.on('extension-unloaded', (event, extension) => {
    appendExtensionLog(extension.path, 'warn', 'extension-unloaded', extension.id);
  });
  targetSession.on('extension-removed', (event, extension) => {
    appendExtensionLog(extension.path, 'warn', 'extension-removed', extension.id);
  });
}

ipcMain.on('open-download-path', (event, filePath) => {
  if (filePath) {
    shell.showItemInFolder(filePath);
  }
});

ipcMain.on('open-download-file', async (event, filePath) => {
  if (!filePath) return;
  try {
    await shell.openPath(filePath);
  } catch (error) {
    console.error('Failed to open downloaded file:', error);
  }
});

ipcMain.on('download-pause', (event, downloadId) => {
  const item = downloadItemsById.get(downloadId);
  if (!item) return;
  try {
    item.pause();
  } catch (error) {
    console.error('Failed to pause download:', error);
  }
});

ipcMain.on('download-resume', (event, downloadId) => {
  const item = downloadItemsById.get(downloadId);
  if (!item) return;
  try {
    item.resume();
  } catch (error) {
    console.error('Failed to resume download:', error);
  }
});

ipcMain.on('download-cancel', (event, downloadId) => {
  const item = downloadItemsById.get(downloadId);
  if (!item) return;
  try {
    item.cancel();
  } catch (error) {
    console.error('Failed to cancel download:', error);
  }
});

ipcMain.on('download-retry', (event, url) => {
  if (!url || !mainWindow) return;
  try {
    mainWindow.webContents.downloadURL(url);
  } catch (error) {
    console.error('Failed to retry download:', error);
  }
});

function setupWebviewWindowHandler() {
  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() !== 'webview') {
      return;
    }

    contents.setWindowOpenHandler(({ url }) => {
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
          const ownerWindow = contents.getOwnerBrowserWindow();
          if (ownerWindow) {
            ownerWindow.webContents.send('open-new-tab', url);
          } else {
            contents.loadURL(url);
          }
        } else {
          shell.openExternal(url);
        }
      } catch (error) {
        console.error('Invalid popup URL:', url, error);
      }

      return { action: 'deny' };
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      webviewTag: true
    },
    title: 'Byteiq Browser',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png')
  });

  // Handle downloads
  mainWindow.webContents.session.on('will-download', (event, item) => {
    const downloadId = `d_${Date.now()}_${downloadSeq++}`;
    const fileName = item.getFilename();
    const fileSize = item.getTotalBytes();

    downloadItemsById.set(downloadId, item);

    if (mainWindow) {
      mainWindow.webContents.send('download-progress', {
        id: downloadId,
        fileName,
        received: item.getReceivedBytes(),
        total: fileSize,
        state: 'progressing',
        savePath: item.getSavePath(),
        url: item.getURL(),
        mimeType: item.getMimeType(),
        paused: item.isPaused()
      });
    }

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        console.log('Download is interrupted but can be resumed');
        if (mainWindow) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            fileName,
            received: item.getReceivedBytes(),
            total: fileSize,
            state: 'interrupted',
            savePath: item.getSavePath(),
            url: item.getURL(),
            mimeType: item.getMimeType(),
            paused: item.isPaused()
          });
        }
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          console.log('Download is paused');
          if (mainWindow) {
            mainWindow.webContents.send('download-progress', {
              id: downloadId,
              fileName,
              received: item.getReceivedBytes(),
              total: fileSize,
              state: 'progressing',
              savePath: item.getSavePath(),
              url: item.getURL(),
              mimeType: item.getMimeType(),
              paused: true
            });
          }
        } else {
          console.log(`Received bytes: ${item.getReceivedBytes()}`);
          if (mainWindow) {
            mainWindow.webContents.send('download-progress', {
              id: downloadId,
              fileName,
              received: item.getReceivedBytes(),
              total: fileSize,
              state: 'progressing',
              savePath: item.getSavePath(),
              url: item.getURL(),
              mimeType: item.getMimeType(),
              paused: false
            });
          }
        }
      }
    });

    item.once('done', (event, state) => {
      if (state === 'completed') {
        console.log('Download successfully');
        if (mainWindow) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            fileName,
            state: 'completed',
            savePath: item.getSavePath(),
            url: item.getURL(),
            mimeType: item.getMimeType(),
            received: item.getReceivedBytes(),
            total: fileSize,
            paused: item.isPaused()
          });
        }
      } else if (state === 'cancelled') {
        console.log('Download cancelled');
        if (mainWindow) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            fileName,
            state: 'cancelled',
            savePath: item.getSavePath(),
            url: item.getURL(),
            mimeType: item.getMimeType(),
            received: item.getReceivedBytes(),
            total: fileSize,
            paused: item.isPaused()
          });
        }
      } else {
        console.log(`Download failed: ${state}`);
        if (mainWindow) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            fileName,
            state: 'failed',
            error: state,
            savePath: item.getSavePath(),
            url: item.getURL(),
            mimeType: item.getMimeType(),
            received: item.getReceivedBytes(),
            total: fileSize,
            paused: item.isPaused()
          });
        }
      }

      downloadItemsById.delete(downloadId);
    });
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    downloadItemsById.clear();
    // 关闭开发者工具视图
    if (devtoolsView) {
      devtoolsView.webContents.destroy();
      devtoolsView = null;
    }
  });

  // 窗口大小改变时更新开发者工具位置
  mainWindow.on('resize', () => {
    if (!devtoolsView) return;

    const [windowWidth, windowHeight] = mainWindow.getSize();
    const sidebarWidth = devtoolsView.getBounds().width;
    const toolbarHeight = 72;

    const devtoolsHeaderHeight = 36;

    devtoolsView.setBounds({
      x: windowWidth - sidebarWidth,
      y: toolbarHeight + devtoolsHeaderHeight,
      width: sidebarWidth,
      height: windowHeight - toolbarHeight - devtoolsHeaderHeight
    });
  });
}

function createMenu() {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null);
}

// 获取版本信息
ipcMain.handle('get-version-info', () => {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    v8Version: process.versions.v8
  };
});

// 扩展管理
ipcMain.handle('extensions-list', () => {
  const list = getStoredExtensions();
  const enriched = list.map((item) => {
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
  const {
    extensionId,
    sourceId,
    level,
    message,
    detail
  } = payload;

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

  let list = getStoredExtensions();
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
      const extension = existing || await loadExtensionByPath(resolvedPath);
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
    parent: mainWindow || undefined,
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
    appendExtensionLog(resolvedPath, 'error', `did-fail-load(${errorCode}) ${errorDescription}`, detail);
  });
  win.webContents.on('render-process-gone', (event, details) => {
    appendExtensionLog(resolvedPath, 'error', 'render-process-gone', JSON.stringify(details || {}));
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

// 开发者工具侧边栏管理
ipcMain.on('toggle-devtools-sidebar', (event, { webContentsId, width }) => {
  if (!mainWindow) return;

  if (devtoolsView) {
    // 关闭开发者工具
    mainWindow.removeBrowserView(devtoolsView);
    devtoolsView.webContents.destroy();
    devtoolsView = null;
    devtoolsWebContentsId = null;
    mainWindow.webContents.send('devtools-sidebar-closed');
    return;
  }

  // 打开开发者工具
  devtoolsView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devtools: true
    }
  });

  mainWindow.addBrowserView(devtoolsView);

  const [windowWidth, windowHeight] = mainWindow.getSize();
  const sidebarWidth = width || 400;
  const toolbarHeight = 72; // tabs + toolbar
  const devtoolsHeaderHeight = 36; // 开发者工具标题栏高度

  devtoolsView.setBounds({
    x: windowWidth - sidebarWidth,
    y: toolbarHeight + devtoolsHeaderHeight,
    width: sidebarWidth,
    height: windowHeight - toolbarHeight - devtoolsHeaderHeight
  });

  devtoolsView.setAutoResize({ width: false, height: true });

  // 获取目标webview的webContents
  const webContents = webContentsId ? require('electron').webContents.fromId(webContentsId) : null;

  if (webContents) {
    devtoolsWebContentsId = webContentsId;
    webContents.setDevToolsWebContents(devtoolsView.webContents);
    webContents.openDevTools();
  }

  mainWindow.webContents.send('devtools-sidebar-opened', { width: sidebarWidth });
});

// 更新开发者工具侧边栏宽度
ipcMain.on('resize-devtools-sidebar', (event, { width }) => {
  if (!mainWindow || !devtoolsView) return;

  const [windowWidth, windowHeight] = mainWindow.getSize();
  const toolbarHeight = 72;
  const devtoolsHeaderHeight = 36;

  devtoolsView.setBounds({
    x: windowWidth - width,
    y: toolbarHeight + devtoolsHeaderHeight,
    width: width,
    height: windowHeight - toolbarHeight - devtoolsHeaderHeight
  });
});

// 窗口大小改变时更新开发者工具位置
ipcMain.on('window-resized', (event, { width, height }) => {
  if (!mainWindow || !devtoolsView) return;

  const sidebarWidth = devtoolsView.getBounds().width;
  const toolbarHeight = 72;
  const devtoolsHeaderHeight = 36;

  devtoolsView.setBounds({
    x: width - sidebarWidth,
    y: toolbarHeight + devtoolsHeaderHeight,
    width: sidebarWidth,
    height: height - toolbarHeight - devtoolsHeaderHeight
  });
});

app.whenReady().then(() => {
  setupWebviewWindowHandler();
  createWindow();
  createMenu();
  attachExtensionListeners();
  loadEnabledExtensions();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
