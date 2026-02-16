const { app, BrowserWindow, BrowserView, Menu, dialog, shell, ipcMain, session } = require('electron');
const fs = require('fs');
const https = require('https');
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
function requestText(urlString, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = ''
  } = options;

  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (error) {
      reject(error);
      return;
    }

    const requestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers,
      rejectUnauthorized: false // 允许自签名证书
    };

    const request = https.request(requestOptions, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        let responseText;
        const buffer = Buffer.concat(chunks);

        // 检查是否是 gzip 压缩
        const contentEncoding = response.headers['content-encoding'];
        if (contentEncoding === 'gzip' || contentEncoding === 'deflate') {
          try {
            const zlib = require('zlib');
            responseText = contentEncoding === 'gzip'
              ? zlib.gunzipSync(buffer).toString('utf8')
              : zlib.inflateSync(buffer).toString('utf8');
          } catch (decompressError) {
            console.error('[Translation] Decompress error:', decompressError.message);
            responseText = buffer.toString('utf8');
          }
        } else {
          responseText = buffer.toString('utf8');
        }

        let json = null;
        if (responseText) {
          try {
            json = JSON.parse(responseText);
          } catch (error) {
            json = null;
          }
        }

        resolve({
          statusCode: response.statusCode || 500,
          headers: response.headers,
          bodyText: responseText,
          json,
          finalUrl: urlString
        });
      });
    });

    request.on('error', (error) => {
      console.error('[Translation] Request error:', error.message);
      reject(error);
    });

    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function mergeCookies(cookieJar, setCookieHeaders) {
  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : (setCookieHeaders ? [setCookieHeaders] : []);

  headers.forEach((item) => {
    const pair = String(item).split(';')[0];
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) return;
    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1).trim();
    if (!key) return;
    cookieJar[key] = value;
  });
}

function serializeCookies(cookieJar) {
  return Object.entries(cookieJar)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function resolveRedirectUrl(currentUrl, location) {
  if (!location) return '';
  if (/^https?:\/\//i.test(location)) return location;
  return new URL(location, currentUrl).toString();
}

const BING_TRANSLATOR_URL = 'https://www.bing.com/translator';
const BING_USER_AGENT = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/122.0.0.0',
  'Safari/537.36'
].join(' ');

let cachedBingSession = null;

function parseBingSession(html, pageUrl, cookieJar) {
  const igMatch = html.match(/IG:"([^"]+)"/);
  const iidMatch = html.match(/data-iid="([^"]+)"/);
  const abuseMatch = html.match(
    /params_AbusePreventionHelper\s*=\s*\[([^\]]+)\]/
  );

  if (!igMatch || !iidMatch || !abuseMatch) {
    return null;
  }

  const parts = abuseMatch[1].split(',');
  const key = parts[0] ? parts[0].trim() : '';
  const token = parts[1]
    ? parts[1].trim().replace(/^"|"$/g, '')
    : '';
  const intervalMs = Number.parseInt(parts[2] || '', 10) || 300000;

  if (!key || !token) {
    return null;
  }

  return {
    origin: new URL(pageUrl).origin,
    referer: pageUrl,
    ig: igMatch[1],
    iid: iidMatch[1],
    key,
    token,
    cookieJar: { ...cookieJar },
    requestSeq: 1,
    expiresAt: Date.now() + Math.max(60000, intervalMs - 30000)
  };
}

async function getBingSession(forceRefresh = false) {
  if (
    !forceRefresh
    && cachedBingSession
    && cachedBingSession.expiresAt > Date.now()
  ) {
    console.log('[Translation] Using cached Bing session');
    return cachedBingSession;
  }

  console.log('[Translation] Fetching new Bing session...');
  let currentUrl = BING_TRANSLATOR_URL;
  const cookieJar = {};
  let pageResult = null;

  for (let i = 0; i < 6; i += 1) {
    console.log('[Translation] Requesting:', currentUrl);
    const result = await requestText(currentUrl, {
      method: 'GET',
      headers: {
        'User-Agent': BING_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml'
      }
    });

    console.log('[Translation] Response status:', result.statusCode);

    mergeCookies(cookieJar, result.headers['set-cookie']);

    if (
      [301, 302, 307, 308].includes(result.statusCode)
      && result.headers.location
    ) {
      currentUrl = resolveRedirectUrl(currentUrl, result.headers.location);
      console.log('[Translation] Redirecting to:', currentUrl);
      continue;
    }

    pageResult = result;
    break;
  }

  if (
    !pageResult
    || pageResult.statusCode < 200
    || pageResult.statusCode >= 300
  ) {
    throw new Error('Failed to load Bing translator page');
  }

  const session = parseBingSession(pageResult.bodyText, currentUrl, cookieJar);
  if (!session) {
    throw new Error('Failed to parse Bing translation token');
  }

  cachedBingSession = session;
  return cachedBingSession;
}

function extractBingTranslation(bodyText) {
  let payload = null;
  try {
    payload = JSON.parse(bodyText);
  } catch (error) {
    console.error('[Translation] Failed to parse Bing response:', error.message);
    console.error('[Translation] Response text (first 200 chars):', bodyText.substring(0, 200));
    return '';
  }

  if (!Array.isArray(payload) || payload.length === 0) {
    console.error('[Translation] Invalid payload structure');
    return '';
  }

  const firstRow = payload[0];
  if (!firstRow || !Array.isArray(firstRow.translations)) {
    console.error('[Translation] No translations in response');
    return '';
  }

  const firstTranslation = firstRow.translations[0];
  const result = firstTranslation && firstTranslation.text
    ? firstTranslation.text
    : '';

  return result;
}

async function translateTextWithBing(text, targetLanguage, retry = true) {
  let session;
  try {
    session = await getBingSession(!retry);
  } catch (sessionError) {
    console.error('[Bing翻译] 获取会话失败:', sessionError.message);
    throw sessionError;
  }

  const query = new URLSearchParams({
    isVertical: '1',
    IG: session.ig,
    IID: `${session.iid}.${session.requestSeq++}`
  });
  const url = `${session.origin}/ttranslatev3?${query.toString()}`;

  const body = new URLSearchParams({
    fromLang: 'auto-detect',
    text,
    to: targetLanguage,
    token: session.token,
    key: session.key
  }).toString();

  const result = await requestText(url, {
    method: 'POST',
    body,
    headers: {
      'User-Agent': BING_USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Content-Length': Buffer.byteLength(body),
      'Referer': session.referer,
      'Origin': session.origin,
      'Accept': '*/*',
      'Cookie': serializeCookies(session.cookieJar)
    }
  });

  if (result.statusCode === 429 && retry) {
    cachedBingSession = null;
    return translateTextWithBing(text, targetLanguage, false);
  }

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`Bing translate request failed (${result.statusCode})`);
  }

  const translated = extractBingTranslation(result.bodyText);
  if (!translated) {
    throw new Error('Bing translation result is empty');
  }

  return translated;
}

ipcMain.handle('get-version-info', () => {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    v8Version: process.versions.v8
  };
});

// 翻译处理
ipcMain.handle('translate-text-batch', async (event, payload = {}) => {
  const {
    engine,
    texts,
    targetLanguage
  } = payload || {};

  if (engine !== 'bing') {
    return { ok: false, message: 'Only Bing translator is supported' };
  }

  if (!Array.isArray(texts) || texts.length === 0) {
    return { ok: true, translations: [] };
  }

  const safeTexts = texts.map((item) => String(item || '').trim());
  if (safeTexts.some((item) => !item)) {
    return { ok: false, message: 'Source text cannot be empty' };
  }

  const to = String(targetLanguage || '').trim();
  if (!to) {
    return { ok: false, message: 'Missing target language' };
  }

  try {
    const translations = [];
    for (let i = 0; i < safeTexts.length; i++) {
      const translated = await translateTextWithBing(safeTexts[i], to);
      translations.push(translated);
    }

    if (translations.length !== safeTexts.length) {
      return { ok: false, message: 'Translation response count mismatch' };
    }

    console.log(`[Bing翻译] 完成: ${texts.length} 个文本块`);
    return {
      ok: true,
      translations
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error('[Bing翻译] 失败:', message);
    return { ok: false, message };
  }
});

// AI翻译处理
ipcMain.handle('translate-text-ai', async (event, payload = {}) => {
  const {
    texts,
    targetLanguage,
    endpoint,
    apiKey,
    requestType,
    model,
    streaming
  } = payload || {};

  if (!Array.isArray(texts) || texts.length === 0) {
    return { ok: true, translations: [] };
  }

  if (!endpoint || !apiKey) {
    console.error('[AI翻译] 缺少API端点或密钥');
    return { ok: false, message: '缺少AI翻译配置：API端点或密钥' };
  }

  const targetLangNames = {
    'zh-Hans': '简体中文',
    'en': 'English',
    'ja': '日本語',
    'ko': '한국어',
    'fr': 'Français',
    'de': 'Deutsch',
    'es': 'Español',
    'ru': 'Русский'
  };
  const targetLangName = targetLangNames[targetLanguage] || targetLanguage;

  try {
    // 保存 sender 用于流式更新
    const senderWebContents = event.sender;
    const useStreaming = streaming !== false;

    const translations = await callAITranslation({
      texts,
      targetLanguage: targetLangName,
      endpoint,
      apiKey,
      requestType: requestType || 'openai-chat',
      model,
      senderWebContents,
      streaming: useStreaming
    });

    if (translations.length !== texts.length) {
      console.error('[AI翻译] 结果数量不匹配');
      return { ok: false, message: 'AI翻译结果数量不匹配' };
    }

    console.log(`[AI翻译] 完成: ${texts.length} 个文本块`);
    return {
      ok: true,
      translations
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error('[AI翻译] 失败:', message);
    return { ok: false, message };
  }
});

async function callAITranslation(options) {
  const { texts, targetLanguage, endpoint, apiKey, requestType, model, senderWebContents, streaming } = options;

  // 构建翻译请求
  let prompt = `请你帮我把以下文字翻译为${targetLanguage}，冒号后跟翻译后的内容，保持"翻译块:"的格式不变：\n`;
  texts.forEach((text, index) => {
    prompt += `翻译块: ${text}\n`;
  });

  let requestBody;
  let url = endpoint;

  // 根据请求类型设置默认模型
  const defaultModels = {
    'openai-chat': 'gpt-3.5-turbo',
    'openai-response': 'gpt-3.5-turbo-instruct',
    'anthropic': 'claude-3-haiku-20240307'
  };
  const actualModel = model || defaultModels[requestType] || defaultModels['openai-chat'];

  if (requestType === 'openai-chat') {
    // OpenAI Chat 兼容格式
    if (endpoint.endsWith('/chat/completions')) {
      url = endpoint;
    } else if (endpoint.endsWith('/v1') || endpoint.endsWith('/v1/')) {
      url = endpoint.replace(/\/$/, '') + '/chat/completions';
    } else {
      url = endpoint + (endpoint.endsWith('/') ? 'chat/completions' : '/chat/completions');
    }
    requestBody = {
      model: actualModel,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      stream: !!streaming
    };
  } else if (requestType === 'anthropic') {
    // Anthropic 格式
    if (endpoint.endsWith('/messages')) {
      url = endpoint;
    } else {
      url = endpoint + (endpoint.endsWith('/') ? 'messages' : '/messages');
    }
    requestBody = {
      model: actualModel,
      max_tokens: 4096,
      messages: [
        { role: 'user', content: prompt }
      ],
      stream: !!streaming
    };
  } else {
    // OpenAI Response 格式（简单文本补全）
    if (endpoint.endsWith('/completions')) {
      url = endpoint;
    } else {
      url = endpoint + (endpoint.endsWith('/') ? 'completions' : '/completions');
    }
    requestBody = {
      model: actualModel,
      prompt: prompt,
      max_tokens: 4096,
      temperature: 0.3,
      stream: !!streaming
    };
  }

  const bodyString = JSON.stringify(requestBody);
  const parsedUrl = new URL(url);

  // 如果是非流式模式，直接请求并解析
  if (!streaming) {
    return await callAITranslationNonStreaming({ url, parsedUrl, bodyString, apiKey, requestType, texts });
  }

  // 流式模式
  // 用于存储流式响应内容
  let fullContent = '';
  const translations = [];
  let lastSentCount = 0;

  // 解析并提取翻译块的辅助函数
  const parseAndNotify = (content) => {
    const lines = content.split('\n');
    // 流式响应时，最后一行可能还没输出完整（没有换行结尾），不要提前解析
    if (!content.endsWith('\n')) {
      lines.pop();
    }
    const newTranslations = [];

    for (const line of lines) {
      const match = line.match(/^翻译块:\s*(.+)$/);
      if (match) {
        newTranslations.push(match[1].trim());
      }
    }

    // 如果有新的翻译块，发送增量更新
    if (newTranslations.length > lastSentCount && senderWebContents) {
      const incremental = newTranslations.slice(lastSentCount);
      senderWebContents.send('translation-stream-update', {
        translations: newTranslations,
        incremental: incremental,
        startIndex: lastSentCount,
        total: texts.length
      });
      lastSentCount = newTranslations.length;
    }

    return newTranslations;
  };

  await new Promise((resolve, reject) => {
    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || undefined,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': requestType === 'anthropic' ? apiKey : undefined
      },
      rejectUnauthorized: false
    };

    // 移除undefined的header
    Object.keys(requestOptions.headers).forEach(key => {
      if (requestOptions.headers[key] === undefined) {
        delete requestOptions.headers[key];
      }
    });

    const request = https.request(requestOptions, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const errorText = Buffer.concat(chunks).toString('utf8');
          reject(new Error(`AI API请求失败 (${response.statusCode}): ${errorText.substring(0, 200)}`));
        });
        return;
      }

      let buffer = '';

      response.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留不完整的行

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // 处理 SSE 格式
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const json = JSON.parse(data);
              let contentDelta = '';

              if (requestType === 'anthropic') {
                // Anthropic stream format
                if (json.type === 'content_block_delta' && json.delta?.text) {
                  contentDelta = json.delta.text;
                }
              } else if (requestType === 'openai-response') {
                // OpenAI completions stream format
                contentDelta = json.choices?.[0]?.text || '';
              } else {
                // OpenAI chat stream format
                contentDelta = json.choices?.[0]?.delta?.content || '';
              }

              if (contentDelta) {
                fullContent += contentDelta;
                parseAndNotify(fullContent);
              }
            } catch (e) {
              // 忽略解析错误，可能是部分数据
            }
          } else if (trimmed.startsWith('event:')) {
            // 忽略事件类型行
            continue;
          }
        }
      });

      response.on('end', () => {
        resolve();
      });

      response.on('error', (error) => {
        console.error('[AI翻译] 响应错误:', error.message);
        reject(error);
      });
    });

    request.on('error', (error) => {
      console.error('[AI翻译] 请求错误:', error.message);
      reject(error);
    });

    request.write(bodyString);
    request.end();
  });

  // 最终解析翻译结果
  const finalTranslations = [];
  const lines = fullContent.split('\n');

  for (const line of lines) {
    const match = line.match(/^翻译块:\s*(.+)$/);
    if (match) {
      finalTranslations.push(match[1].trim());
    }
  }

  // 如果解析失败，尝试其他方式
  if (finalTranslations.length !== texts.length) {
    finalTranslations.length = 0;

    const allMatches = fullContent.match(/翻译块:\s*.+/g);
    if (allMatches && allMatches.length >= texts.length) {
      for (let i = 0; i < texts.length; i++) {
        const match = allMatches[i]?.match(/^翻译块:\s*(.+)$/);
        if (match) {
          finalTranslations.push(match[1].trim());
        }
      }
    }
  }

  if (finalTranslations.length !== texts.length) {
    console.error(`[AI翻译] 解析数量不匹配: 期望 ${texts.length}, 实际 ${finalTranslations.length}`);
    while (finalTranslations.length < texts.length) {
      finalTranslations.push(texts[finalTranslations.length]);
    }
  }

  return finalTranslations;
}

// 非流式翻译
async function callAITranslationNonStreaming(options) {
  const { parsedUrl, bodyString, apiKey, requestType, texts } = options;

  const result = await new Promise((resolve, reject) => {
    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || undefined,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': requestType === 'anthropic' ? apiKey : undefined
      },
      rejectUnauthorized: false
    };

    // 移除undefined的header
    Object.keys(requestOptions.headers).forEach(key => {
      if (requestOptions.headers[key] === undefined) {
        delete requestOptions.headers[key];
      }
    });

    const request = https.request(requestOptions, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: response.statusCode || 500,
          bodyText: responseText
        });
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.write(bodyString);
    request.end();
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`AI API请求失败 (${result.statusCode}): ${result.bodyText.substring(0, 200)}`);
  }

  // 解析响应
  let responseContent = '';
  try {
    const jsonResponse = JSON.parse(result.bodyText);

    if (requestType === 'anthropic') {
      responseContent = jsonResponse.content?.[0]?.text || '';
    } else if (requestType === 'openai-response') {
      responseContent = jsonResponse.choices?.[0]?.text || '';
    } else {
      // OpenAI Chat 格式
      responseContent = jsonResponse.choices?.[0]?.message?.content || '';
    }
  } catch (parseError) {
    throw new Error('AI API响应解析失败');
  }

  // 解析翻译结果
  const finalTranslations = [];
  const lines = responseContent.split('\n');

  for (const line of lines) {
    const match = line.match(/^翻译块:\s*(.+)$/);
    if (match) {
      finalTranslations.push(match[1].trim());
    }
  }

  // 如果解析失败，尝试其他方式
  if (finalTranslations.length !== texts.length) {
    finalTranslations.length = 0;

    const allMatches = responseContent.match(/翻译块:\s*.+/g);
    if (allMatches && allMatches.length >= texts.length) {
      for (let i = 0; i < texts.length; i++) {
        const match = allMatches[i]?.match(/^翻译块:\s*(.+)$/);
        if (match) {
          finalTranslations.push(match[1].trim());
        }
      }
    }
  }

  if (finalTranslations.length !== texts.length) {
    console.error(`[AI翻译] 解析数量不匹配: 期望 ${texts.length}, 实际 ${finalTranslations.length}`);
    while (finalTranslations.length < texts.length) {
      finalTranslations.push(texts[finalTranslations.length]);
    }
  }

  return finalTranslations;
}

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
