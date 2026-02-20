const { registerExtensionIpcHandlers } = require('./extensions-ipc-handlers');

function createExtensionsManager(options) {
  const { BrowserWindow, dialog, fs, ipcMain, path, session, store, getMainWindow } = options;

  const resolveMainWindow = () => {
    return typeof getMainWindow === 'function' ? getMainWindow() : null;
  };

  const EXTENSIONS_KEY = 'extensions';
  const EXTENSION_LOG_LIMIT = 200;

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

    const popup =
      (manifest.action && manifest.action.default_popup) ||
      (manifest.browser_action && manifest.browser_action.default_popup) ||
      '';
    const options =
      manifest.options_page || (manifest.options_ui && manifest.options_ui.page) || '';

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

    const background =
      manifest && manifest.background
        ? manifest.background.service_worker || manifest.background.page || ''
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
      permissions: Array.isArray(manifest && manifest.permissions) ? manifest.permissions : [],
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
    return list.findIndex(item => {
      if (!item || !item.path) return false;
      return normalizeExtensionPath(item.path) === normalized;
    });
  }

  function getTargetSession() {
    const mainWindow = resolveMainWindow();
    if (mainWindow && mainWindow.webContents && mainWindow.webContents.session) {
      return mainWindow.webContents.session;
    }
    return session.defaultSession;
  }

  function getLoadedExtensionByPath(targetSession, extPath) {
    const normalized = normalizeExtensionPath(extPath);
    const all = targetSession.getAllExtensions();
    return (
      Object.values(all).find(ext => {
        return normalizeExtensionPath(ext.path) === normalized;
      }) || null
    );
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

  registerExtensionIpcHandlers({
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
  });

  return {
    attachExtensionListeners,
    loadEnabledExtensions
  };
}

module.exports = {
  createExtensionsManager
};
