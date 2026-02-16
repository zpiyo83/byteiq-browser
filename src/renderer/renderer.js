const { ipcRenderer, clipboard } = require('electron');
const Store = require('electron-store');
const { initI18n, t, setLocale } = require('./i18n');
const { createBrowserManager } = require('./modules/navigation/browser-manager');
const { createContextMenuManager } = require('./modules/ui/context-menu-manager');
const { createDownloadsManager } = require('./modules/downloads/downloads-manager');
const { createAiManager } = require('./modules/ui/ai-manager');
const { createFindManager } = require('./modules/ui/find-manager');
const { createListPanelManager } = require('./modules/ui/list-panel-manager');
const { createOverlayManager } = require('./modules/ui/overlay-manager');
const { createShortcutsManager } = require('./modules/ui/shortcuts-manager');
const { createTabManager } = require('./modules/tabs/tab-manager');
const { createExtensionsManager } = require('./modules/extensions/extensions-manager');
const { createTranslationManager } = require('./modules/ui/translation-manager');
const modalManager = require('./modules/ui/modal-manager');
const store = new Store();

// 尽早应用深色模式，避免闪烁
if (store.get('settings.darkMode')) {
  document.body.classList.add('dark-mode');
}

const urlInput = document.getElementById('url-input');
const goBtn = document.getElementById('go-btn');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const refreshBtn = document.getElementById('refresh-btn');
const homeBtn = document.getElementById('home-btn');
const historyBtn = document.getElementById('history-btn');
const bookmarksListBtn = document.getElementById('bookmarks-list-btn');
const devtoolsBtn = document.getElementById('devtools-btn');
const settingsBtn = document.getElementById('settings-btn');
const downloadsBtn = document.getElementById('downloads-btn');
const translateToggleBtn = document.getElementById('translate-toggle-btn');
const bookmarkBtn = document.getElementById('bookmark-btn');
const clearUrlBtn = document.getElementById('clear-url-btn');
const progressBar = document.getElementById('progress-bar');
const historyPanel = document.getElementById('history-panel');
const settingsPanel = document.getElementById('settings-panel');
const bookmarksPanel = document.getElementById('bookmarks-panel');
const downloadsPanel = document.getElementById('downloads-panel');
const historyList = document.getElementById('history-list');
const bookmarksList = document.getElementById('bookmarks-list');
const downloadsList = document.getElementById('downloads-list');
const historySearchInput = document.getElementById('history-search-input');
const bookmarksSearchInput = document.getElementById('bookmarks-search-input');
const downloadsSearchInput = document.getElementById('downloads-search-input');
const downloadsFilters = document.getElementById('downloads-filters');
const downloadsClearAllBtn = document.getElementById('downloads-clear-all-btn');
const downloadsClearCompletedBtn = document.getElementById('downloads-clear-completed-btn');
const downloadsClearFailedBtn = document.getElementById('downloads-clear-failed-btn');
const searchEngineSelect = document.getElementById('search-engine-select');
const startupUrlInput = document.getElementById('startup-url-input');
const incognitoToggleBtn = document.getElementById('incognito-toggle-btn');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomResetBtn = document.getElementById('zoom-reset-btn');
const zoomLevelText = document.getElementById('zoom-level-text');
const clearDataBtn = document.getElementById('clear-data-btn');
const exportDataBtn = document.getElementById('export-data-btn');
const restoreSessionToggle = document.getElementById('restore-session-toggle');
const extensionsList = document.getElementById('extensions-list');
const extensionsAddBtn = document.getElementById('extensions-add-btn');
const extensionsRefreshBtn = document.getElementById('extensions-refresh-btn');
const extensionsEmpty = document.getElementById('extensions-empty');
const aiEndpointInput = document.getElementById('ai-endpoint-input');
const aiApiKeyInput = document.getElementById('ai-api-key-input');
const aiRequestTypeSelect = document.getElementById('ai-request-type-select');
const translateEnableToggle = document.getElementById('translate-enable-toggle');
const translateEngineSelect = document.getElementById('translate-engine-select');
const translateTargetLangSelect = document.getElementById(
  'translate-target-lang-select'
);
const translateDisplayModeSelect = document.getElementById(
  'translate-display-mode-select'
);
const translateCurrentPageBtn = document.getElementById(
  'translate-current-page-btn'
);
const aiTranslationConfig = document.getElementById('ai-translation-config');
const translateAiEndpointInput = document.getElementById('translate-ai-endpoint-input');
const translateAiApiKeyInput = document.getElementById('translate-ai-api-key-input');
const translateAiRequestTypeSelect = document.getElementById('translate-ai-request-type-select');
const translateAiModelInput = document.getElementById('translate-ai-model-input');
const translateStreamingToggle = document.getElementById('translate-streaming-toggle');
const translationAdvancedToggle = document.getElementById('translation-advanced-toggle');
const translationAdvancedContent = document.getElementById('translation-advanced-content');
const tabsBar = document.getElementById('tabs-bar');
const newTabBtn = document.getElementById('new-tab-btn');
const webviewsContainer = document.getElementById('webviews-container');
const newTabTemplate = document.getElementById('new-tab-template');
const aiSidebar = document.getElementById('ai-sidebar');
const toggleAiBtn = document.getElementById('toggle-ai-btn');
const closeAiBtn = document.getElementById('close-ai-btn');
const aiInput = document.getElementById('ai-input');
const aiSendBtn = document.getElementById('ai-send-btn');
const aiChatArea = document.getElementById('ai-chat-area');
const findBox = document.getElementById('find-box');
const findInput = document.getElementById('find-input');
const findResults = document.getElementById('find-results');
const findPrev = document.getElementById('find-prev');
const findNext = document.getElementById('find-next');
const findClose = document.getElementById('find-close');
const contextMenu = document.getElementById('context-menu');
const tabContextMenu = document.getElementById('tab-context-menu');
const overlayBackdrop = document.getElementById('overlay-backdrop');

let isIncognito = false;
let browserManager = null;
let translationManager = null;

initI18n();

// 初始化模态框管理器
modalManager.init();

const overlayManager = createOverlayManager({
  documentRef: document,
  overlayBackdrop
});

function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function setTranslateToggleActive(enabled) {
  if (!translateToggleBtn) return;
  const active = !!enabled;
  translateToggleBtn.classList.toggle('active', active);
  translateToggleBtn.classList.remove('loading');
  translateToggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  translateToggleBtn.setAttribute('title', active ? '翻译已开启' : '翻译已关闭');
}

function setTranslateLoading(loading) {
  if (!translateToggleBtn) return;
  if (loading) {
    translateToggleBtn.classList.add('loading');
    translateToggleBtn.classList.add('active');
    translateToggleBtn.setAttribute('title', '正在翻译...');
  } else {
    translateToggleBtn.classList.remove('loading');
    const settings = translationManager ? translationManager.getSettings() : null;
    const enabled = settings ? settings.enabled : false;
    translateToggleBtn.classList.toggle('active', enabled);
    translateToggleBtn.setAttribute('title', enabled ? '翻译已开启' : '翻译已关闭');
  }
}

function updateBookmarkIcon(url) {
  const bookmarks = store.get('bookmarks', []);
  const isBookmarked = bookmarks.some((item) => item.url === url);
  const bookmarkSvg = document.getElementById('bookmark-svg');
  if (bookmarkSvg) {
    bookmarkSvg.classList.toggle('active', isBookmarked);
  }
}

const tabManager = createTabManager({
  applyStoredZoom: (webview) => {
    if (browserManager) {
      browserManager.applyStoredZoom(webview);
    }
  },
  documentRef: document,
  findResults,
  formatUrl: (url) => {
    return browserManager ? browserManager.formatUrl(url) : url;
  },
  getIncognito: () => isIncognito,
  initI18n,
  ipcRenderer,
  newTabBtn,
  newTabTemplate,
  onActiveWebviewChanged: (webview) => {
    if (browserManager) {
      browserManager.onActiveWebviewChanged(webview);
    }
  },
  onWebviewDidStopLoading: (webview) => {
    if (translationManager) {
      translationManager.handleWebviewDidStopLoading(webview);
    }
  },
  progressBar,
  showToast,
  store,
  t,
  tabsBar,
  updateBookmarkIcon,
  webviewsContainer,
  urlInput
});

function updateZoomUI(level) {
  zoomLevelText.innerText = `${Math.round(level * 100)}%`;
}

browserManager = createBrowserManager({
  documentRef: document,
  getActiveTabId: tabManager.getActiveTabId,
  getIncognito: () => isIncognito,
  setIncognito: (value) => {
    isIncognito = value;
  },
  setupWebviewEvents: tabManager.setupWebviewEvents,
  store,
  t,
  updateBookmarkIcon,
  updateTabUrl: tabManager.updateTabUrl,
  updateZoomUI,
  urlInput,
  modalManager
});

const downloadsManager = createDownloadsManager({
  clipboard,
  downloadsClearAllBtn,
  downloadsClearCompletedBtn,
  downloadsClearFailedBtn,
  downloadsFilters,
  downloadsList,
  downloadsPanel,
  downloadsSearchInput,
  ipcRenderer,
  openDownloadPath: (path) => {
    if (path) {
      ipcRenderer.send('open-download-path', path);
    }
  },
  openOverlay: overlayManager.openOverlay,
  showToast,
  store,
  t,
  modalManager
});

const contextMenuManager = createContextMenuManager({
  clipboard,
  contextMenu,
  documentRef: document,
  getActiveTabId: tabManager.getActiveTabId,
  getTabById: tabManager.getTabById,
  tabActions: {
    closeOtherTabs: tabManager.closeOtherTabs,
    closeTab: tabManager.closeTab,
    closeTabsToRight: tabManager.closeTabsToRight,
    duplicateTab: tabManager.duplicateTab,
    setTabPinned: tabManager.setTabPinned
  },
  tabContextMenu,
  windowRef: window
});

const aiManager = createAiManager({
  aiChatArea,
  aiInput,
  aiSendBtn,
  aiSidebar,
  closeAiBtn,
  documentRef: document,
  getActiveTabId: tabManager.getActiveTabId,
  t,
  toggleAiBtn
});

const findManager = createFindManager({
  documentRef: document,
  findBox,
  findClose,
  findInput,
  findNext,
  findPrev,
  findResults,
  getActiveTabId: tabManager.getActiveTabId
});

const listPanelManager = createListPanelManager({
  documentRef: document,
  openTab: tabManager.createTab,
  store,
  t
});

const extensionsManager = createExtensionsManager({
  documentRef: document,
  ipcRenderer,
  modalManager,
  showToast,
  listEl: extensionsList,
  addBtn: extensionsAddBtn,
  refreshBtn: extensionsRefreshBtn,
  emptyEl: extensionsEmpty
});

translationManager = createTranslationManager({
  getActiveWebview: () => {
    const activeTabId = tabManager.getActiveTabId();
    const webview = document.getElementById(`webview-${activeTabId}`);
    return webview && webview.tagName === 'WEBVIEW' ? webview : null;
  },
  ipcRenderer,
  showToast,
  store,
  onTranslationStatusChange: (isTranslating) => {
    setTranslateLoading(isTranslating);
  }
});
setTranslateToggleActive(translationManager.getSettings().enabled);

extensionsManager.init();

const shortcutsManager = createShortcutsManager({
  actions: {
    closeActiveTab: () => {
      tabManager.closeTab(tabManager.getActiveTabId());
    },
    closeAllPanels,
    createTab: tabManager.createTab,
    openBookmarks: () => {
      listPanelManager.showPanel(
        bookmarksPanel,
        bookmarksList,
        'bookmarks',
        bookmarksSearchInput?.value || ''
      );
      overlayManager.openOverlay(bookmarksPanel);
    },
    openDownloads: downloadsManager.openDownloadsPanel,
    openHistory: () => {
      listPanelManager.showPanel(
        historyPanel,
        historyList,
        'history',
        historySearchInput?.value || ''
      );
      overlayManager.openOverlay(historyPanel);
    },
    refreshCurrentPage,
    restoreLastTab: tabManager.restoreLastTab,
    switchToNextTab: tabManager.switchToNextTab,
    switchToPrevTab: tabManager.switchToPrevTab,
    toggleFind: findManager.toggleFind
  },
  documentRef: document,
  getActiveTabId: tabManager.getActiveTabId,
  urlInput,
  windowRef: window
});

tabManager.setNavigateTo((url, id) => {
  browserManager.navigateTo(url, id);
});

tabManager.bindIpc();
downloadsManager.bindEvents();
contextMenuManager.bindEvents();
aiManager.bindEvents();
findManager.bindEvents();
shortcutsManager.bindEvents();

const langSelect = document.getElementById('lang-select');
if (langSelect) {
  langSelect.value = store.get('settings.language', 'zh-CN');
  langSelect.addEventListener('change', () => {
    setLocale(langSelect.value);
  });
}

if (restoreSessionToggle) {
  restoreSessionToggle.checked = store.get('settings.restoreSession', true);
  restoreSessionToggle.addEventListener('change', () => {
    store.set('settings.restoreSession', restoreSessionToggle.checked);
  });
}

bookmarkBtn.addEventListener('click', () => {
  const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
  if (!wv || wv.tagName !== 'WEBVIEW') return;

  const url = wv.getURL();
  const title = wv.getTitle();
  let bookmarks = store.get('bookmarks', []);
  const index = bookmarks.findIndex((item) => item.url === url);

  if (index > -1) {
    bookmarks.splice(index, 1);
  } else {
    bookmarks.unshift({ url, title, time: new Date().toISOString() });
  }

  store.set('bookmarks', bookmarks);
  updateBookmarkIcon(url);
});

historyBtn.addEventListener('click', () => {
  listPanelManager.showPanel(
    historyPanel,
    historyList,
    'history',
    historySearchInput?.value || ''
  );
  overlayManager.openOverlay(historyPanel);
});

bookmarksListBtn.addEventListener('click', () => {
  listPanelManager.showPanel(
    bookmarksPanel,
    bookmarksList,
    'bookmarks',
    bookmarksSearchInput?.value || ''
  );
  overlayManager.openOverlay(bookmarksPanel);
});

downloadsBtn.addEventListener('click', () => {
  downloadsManager.openDownloadsPanel();
});

settingsBtn.addEventListener('click', () => {
  searchEngineSelect.value = store.get('settings.searchEngine', 'bing');
  startupUrlInput.value = store.get('settings.startupUrl', '');
  if (restoreSessionToggle) {
    restoreSessionToggle.checked = store.get('settings.restoreSession', true);
  }
  if (langSelect) {
    langSelect.value = store.get('settings.language', 'zh-CN');
  }
  // 加载AI设置
  aiEndpointInput.value = store.get('settings.aiEndpoint', '');
  aiApiKeyInput.value = store.get('settings.aiApiKey', '');
  aiRequestTypeSelect.value = store.get('settings.aiRequestType', 'openai-chat');
  if (translationManager) {
    const translationSettings = translationManager.getSettings();
    if (translateEnableToggle) {
      translateEnableToggle.checked = translationSettings.enabled;
      setTranslateToggleActive(translationSettings.enabled);
    }
    if (translateEngineSelect) {
      translateEngineSelect.value = translationSettings.engine;
    }
    if (translateTargetLangSelect) {
      translateTargetLangSelect.value = translationSettings.targetLanguage;
    }
    if (translateDisplayModeSelect) {
      translateDisplayModeSelect.value = translationSettings.displayMode;
    }
    // 加载AI翻译配置
    if (translateAiEndpointInput) {
      translateAiEndpointInput.value = translationSettings.aiEndpoint || '';
    }
    if (translateAiApiKeyInput) {
      translateAiApiKeyInput.value = translationSettings.aiApiKey || '';
    }
    if (translateAiRequestTypeSelect) {
      translateAiRequestTypeSelect.value = translationSettings.aiRequestType || 'openai-chat';
    }
    if (translateAiModelInput) {
      translateAiModelInput.value = translationSettings.aiModel || '';
    }
    if (translateStreamingToggle) {
      translateStreamingToggle.checked = translationSettings.streaming !== false;
    }
    // 显示/隐藏AI翻译配置
    if (aiTranslationConfig) {
      aiTranslationConfig.style.display = translationSettings.engine === 'ai' ? 'block' : 'none';
    }
  }
  // 获取版本信息
  ipcRenderer.invoke('get-version-info').then((versions) => {
    const appVersionEl = document.getElementById('about-app-version');
    const electronVersionEl = document.getElementById('about-electron-version');
    const chromiumVersionEl = document.getElementById('about-chromium-version');
    const nodeVersionEl = document.getElementById('about-node-version');
    const v8VersionEl = document.getElementById('about-v8-version');
    if (appVersionEl) appVersionEl.textContent = versions.appVersion;
    if (electronVersionEl) electronVersionEl.textContent = versions.electronVersion;
    if (chromiumVersionEl) chromiumVersionEl.textContent = versions.chromiumVersion;
    if (nodeVersionEl) nodeVersionEl.textContent = versions.nodeVersion;
    if (v8VersionEl) v8VersionEl.textContent = versions.v8Version;
  });
  extensionsManager.refresh();
  overlayManager.openOverlay(settingsPanel);
});

// Settings navigation
document.querySelectorAll('.settings-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const section = btn.getAttribute('data-section');
    if (!section) return;

    // Update nav items
    document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update sections
    document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
    const targetSection = document.getElementById(`settings-${section}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }
  });
});

if (historySearchInput) {
  historySearchInput.addEventListener('input', () => {
    listPanelManager.showPanel(
      historyPanel,
      historyList,
      'history',
      historySearchInput.value
    );
  });
}

if (bookmarksSearchInput) {
  bookmarksSearchInput.addEventListener('input', () => {
    listPanelManager.showPanel(
      bookmarksPanel,
      bookmarksList,
      'bookmarks',
      bookmarksSearchInput.value
    );
  });
}

incognitoToggleBtn.addEventListener('click', () => {
  browserManager.toggleIncognito();
});

if (darkModeToggle) {
  darkModeToggle.addEventListener('change', () => {
    const isDark = darkModeToggle.checked;
    document.body.classList.toggle('dark-mode', isDark);
    store.set('settings.darkMode', isDark);
  });

  if (store.get('settings.darkMode')) {
    document.body.classList.add('dark-mode');
    darkModeToggle.checked = true;
  }
}

zoomInBtn.addEventListener('click', () => {
  const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
  if (wv && wv.tagName === 'WEBVIEW') {
    wv.getZoomFactor((factor) => {
      const newFactor = factor + 0.1;
      wv.setZoomFactor(newFactor);
      updateZoomUI(newFactor);
      browserManager.setZoomForUrl(wv.getURL(), newFactor);
    });
  }
});

zoomOutBtn.addEventListener('click', () => {
  const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
  if (wv && wv.tagName === 'WEBVIEW') {
    wv.getZoomFactor((factor) => {
      const newFactor = Math.max(0.2, factor - 0.1);
      wv.setZoomFactor(newFactor);
      updateZoomUI(newFactor);
      browserManager.setZoomForUrl(wv.getURL(), newFactor);
    });
  }
});

zoomResetBtn.addEventListener('click', () => {
  const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
  if (wv && wv.tagName === 'WEBVIEW') {
    wv.setZoomFactor(1.0);
    updateZoomUI(1.0);
    browserManager.setZoomForUrl(wv.getURL(), 1.0);
  }
});

searchEngineSelect.addEventListener('change', () => {
  store.set('settings.searchEngine', searchEngineSelect.value);
});

startupUrlInput.addEventListener('change', () => {
  store.set('settings.startupUrl', startupUrlInput.value);
});

aiEndpointInput.addEventListener('change', () => {
  store.set('settings.aiEndpoint', aiEndpointInput.value);
});

aiApiKeyInput.addEventListener('change', () => {
  store.set('settings.aiApiKey', aiApiKeyInput.value);
});

aiRequestTypeSelect.addEventListener('change', () => {
  store.set('settings.aiRequestType', aiRequestTypeSelect.value);
});

if (translateEnableToggle) {
  translateEnableToggle.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      enabled: translateEnableToggle.checked
    });
    setTranslateToggleActive(translateEnableToggle.checked);
  });
}

if (translateEngineSelect) {
  translateEngineSelect.addEventListener('change', () => {
    if (!translationManager) return;
    const engine = translateEngineSelect.value || 'bing';
    translationManager.saveSettings({
      engine
    });
    // 显示/隐藏AI翻译配置
    if (aiTranslationConfig) {
      aiTranslationConfig.style.display = engine === 'ai' ? 'block' : 'none';
    }
  });
}

if (translateTargetLangSelect) {
  translateTargetLangSelect.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      targetLanguage: translateTargetLangSelect.value || 'zh-Hans'
    });
  });
}

if (translateDisplayModeSelect) {
  translateDisplayModeSelect.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      displayMode: translateDisplayModeSelect.value || 'replace'
    });
  });
}

// AI翻译配置事件
if (translateAiEndpointInput) {
  translateAiEndpointInput.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      aiEndpoint: translateAiEndpointInput.value
    });
  });
}

if (translateAiApiKeyInput) {
  translateAiApiKeyInput.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      aiApiKey: translateAiApiKeyInput.value
    });
  });
}

if (translateAiRequestTypeSelect) {
  translateAiRequestTypeSelect.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      aiRequestType: translateAiRequestTypeSelect.value
    });
  });
}

if (translateAiModelInput) {
  translateAiModelInput.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      aiModel: translateAiModelInput.value
    });
  });
}

// 流式翻译开关
if (translateStreamingToggle) {
  translateStreamingToggle.addEventListener('change', () => {
    if (!translationManager) return;
    translationManager.saveSettings({
      streaming: translateStreamingToggle.checked
    });
  });
}

// 高级设置折叠
if (translationAdvancedToggle) {
  translationAdvancedToggle.addEventListener('click', () => {
    const parent = translationAdvancedToggle.closest('.advanced-settings');
    if (parent) {
      parent.classList.toggle('expanded');
    }
  });
}

if (translateCurrentPageBtn) {
  translateCurrentPageBtn.addEventListener('click', () => {
    if (!translationManager) return;
    translationManager.translateActiveWebview();
  });
}

if (translateToggleBtn) {
  translateToggleBtn.addEventListener('click', () => {
    if (!translationManager) return;
    const currentEnabled = translationManager.getSettings().enabled;
    const nextEnabled = !currentEnabled;
    translationManager.saveSettings({
      enabled: nextEnabled
    });
    if (translateEnableToggle) {
      translateEnableToggle.checked = nextEnabled;
    }
    setTranslateToggleActive(nextEnabled);
    if (nextEnabled) {
      translationManager.translateActiveWebview();
    }
  });
}

clearDataBtn.addEventListener('click', async () => {
  const confirmed = await modalManager.confirmDelete(
    '确定要清除所有浏览数据吗？此操作不可撤销。',
    '清除数据'
  );
  if (confirmed) {
    store.set('history', []);
    store.set('bookmarks', []);
    await modalManager.success('数据已清除', '完成');
  }
});

exportDataBtn.addEventListener('click', () => {
  const data = {
    bookmarks: store.get('bookmarks', []),
    history: store.get('history', []),
    settings: store.get('settings', {})
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `byteiq-browser-data-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.querySelectorAll('.close-overlay').forEach((btn) => {
  btn.addEventListener('click', () => {
    overlayManager.closeAllOverlays();
  });
});

if (overlayBackdrop) {
  overlayBackdrop.addEventListener('click', () => {
    overlayManager.closeAllOverlays();
  });
}

urlInput.addEventListener('click', () => {
  urlInput.select();
});

urlInput.addEventListener('input', () => {
  clearUrlBtn.style.display = urlInput.value ? 'block' : 'none';
});

clearUrlBtn.addEventListener('click', () => {
  urlInput.value = '';
  urlInput.focus();
  clearUrlBtn.style.display = 'none';
});

goBtn.addEventListener('click', () => {
  if (urlInput.value) browserManager.navigateTo(urlInput.value);
});

urlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && urlInput.value) {
    browserManager.navigateTo(urlInput.value);
  }
});

backBtn.addEventListener('click', () => {
  const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
  if (wv && wv.tagName === 'WEBVIEW' && wv.canGoBack()) {
    wv.goBack();
  }
});

forwardBtn.addEventListener('click', () => {
  const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
  if (wv && wv.tagName === 'WEBVIEW' && wv.canGoForward()) {
    wv.goForward();
  }
});

refreshBtn.addEventListener('click', () => {
  browserManager.refreshCurrentPage();
});

homeBtn.addEventListener('click', () => {
  const startupUrl = store.get('settings.startupUrl', '').trim();
  if (startupUrl) {
    browserManager.navigateTo(startupUrl);
    return;
  }

  const engine = store.get('settings.searchEngine', 'bing');
  const homePages = {
    baidu: 'https://www.baidu.com',
    bing: 'https://www.bing.com',
    google: 'https://www.google.com'
  };
  browserManager.navigateTo(homePages[engine] || homePages.bing);
});

function closeAllPanels() {
  overlayManager.closeAllOverlays();

  if (findBox && findBox.style.display === 'flex') {
    findManager.closeFind();
  }

  contextMenuManager.hideContextMenus();

  if (aiSidebar && !aiSidebar.classList.contains('collapsed')) {
    aiSidebar.classList.add('collapsed');
  }
}

function refreshCurrentPage() {
  const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
  if (wv && wv.tagName === 'WEBVIEW') {
    if (wv.isLoading()) {
      wv.stop();
      showToast(t('toast.loadStopped') || '已停止加载', 'info');
    } else {
      wv.reload();
      showToast(t('toast.refreshing') || '正在刷新...', 'info');
    }
  }
}

devtoolsBtn.addEventListener('click', () => {
  const wv = document.getElementById(`webview-${tabManager.getActiveTabId()}`);
  if (wv && wv.tagName === 'WEBVIEW') {
    const devtoolsSidebar = document.getElementById('devtools-sidebar');
    const mainContainer = document.querySelector('.main-container');
    const isActive = devtoolsSidebar.classList.contains('active');

    if (isActive) {
      // 关闭开发者工具
      ipcRenderer.send('toggle-devtools-sidebar', {});
      devtoolsSidebar.classList.remove('active');
      devtoolsSidebar.style.width = '0';
      mainContainer.classList.remove('devtools-open');
    } else {
      // 打开开发者工具
      const webContentsId = wv.getWebContentsId();
      ipcRenderer.send('toggle-devtools-sidebar', {
        webContentsId,
        width: 400
      });
      devtoolsSidebar.classList.add('active');
      devtoolsSidebar.style.width = '400px';
      mainContainer.classList.add('devtools-open');
    }
  }
});

// 关闭开发者工具按钮
const closeDevtoolsBtn = document.getElementById('close-devtools-btn');
if (closeDevtoolsBtn) {
  closeDevtoolsBtn.addEventListener('click', () => {
    const devtoolsSidebar = document.getElementById('devtools-sidebar');
    const mainContainer = document.querySelector('.main-container');
    ipcRenderer.send('toggle-devtools-sidebar', {});
    devtoolsSidebar.classList.remove('active');
    devtoolsSidebar.style.width = '0';
    mainContainer.classList.remove('devtools-open');
  });
}

// 开发者工具侧边栏拖动调整宽度
const devtoolsResizeHandle = document.getElementById('devtools-resize-handle');
const devtoolsSidebar = document.getElementById('devtools-sidebar');

if (devtoolsResizeHandle && devtoolsSidebar) {
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  devtoolsResizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = devtoolsSidebar.offsetWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const deltaX = startX - e.clientX;
    const newWidth = Math.max(250, Math.min(800, startWidth + deltaX));

    devtoolsSidebar.style.width = newWidth + 'px';
    webviewsContainer.style.marginRight = newWidth + 'px';
    ipcRenderer.send('resize-devtools-sidebar', { width: newWidth });
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// 监听窗口大小变化
window.addEventListener('resize', () => {
  ipcRenderer.send('window-resized', {
    width: window.innerWidth,
    height: window.innerHeight
  });
});

// 监听开发者工具状态
ipcRenderer.on('devtools-sidebar-closed', () => {
  const devtoolsSidebar = document.getElementById('devtools-sidebar');
  const mainContainer = document.querySelector('.main-container');
  if (devtoolsSidebar) {
    devtoolsSidebar.classList.remove('active');
    devtoolsSidebar.style.width = '0';
  }
  if (mainContainer) {
    mainContainer.classList.remove('devtools-open');
  }
});

newTabBtn.addEventListener('click', () => tabManager.createTab());
tabsBar.addEventListener('dblclick', (e) => {
  if (e.target === tabsBar) {
    tabManager.createTab();
  }
});

tabManager.restoreSession();

// 添加快捷键提示到工具栏按钮
function addShortcutHints() {
  const shortcuts = {
    'back-btn': 'Alt+←',
    'forward-btn': 'Alt+→',
    'refresh-btn': 'Ctrl+R / F5',
    'home-btn': 'Alt+Home',
    'url-input': 'Ctrl+L',
    'history-btn': 'Ctrl+H',
    'bookmarks-list-btn': 'Ctrl+B',
    'downloads-btn': 'Ctrl+J',
    'new-tab-btn': 'Ctrl+T'
  };

  Object.entries(shortcuts).forEach(([id, shortcut]) => {
    const el = document.getElementById(id);
    if (el) {
      const currentTitle = el.getAttribute('title') || '';
      if (!currentTitle.includes(shortcut)) {
        el.setAttribute('title', currentTitle ? `${currentTitle} (${shortcut})` : shortcut);
      }
    }
  });

  // 为新建标签页按钮添加提示
  const newTabBtnEl = document.getElementById('new-tab-btn');
  if (newTabBtnEl) {
    newTabBtnEl.setAttribute('title', '新建标签页 (Ctrl+T)');
  }
}

addShortcutHints();
