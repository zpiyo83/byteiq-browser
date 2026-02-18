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
const {
  bindSettingsAndPanelEvents
} = require('./modules/app/events/settings-and-panels-events');
const {
  bindNavigationAndDevtoolsEvents
} = require('./modules/app/events/navigation-and-devtools-events');


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

bindSettingsAndPanelEvents({
  aiApiKeyInput,
  aiEndpointInput,
  aiRequestTypeSelect,
  aiTranslationConfig,
  bookmarkBtn,
  bookmarksList,
  bookmarksListBtn,
  bookmarksPanel,
  bookmarksSearchInput,
  browserManager,
  clearDataBtn,
  darkModeToggle,
  documentRef: document,
  downloadsBtn,
  downloadsManager,
  exportDataBtn,
  extensionsManager,
  historyBtn,
  historyList,
  historyPanel,
  historySearchInput,
  incognitoToggleBtn,
  ipcRenderer,
  listPanelManager,
  modalManager,
  overlayBackdrop,
  overlayManager,
  restoreSessionToggle,
  searchEngineSelect,
  setLocale,
  setTranslateToggleActive,
  settingsPanel,
  settingsBtn,
  startupUrlInput,
  store,
  tabManager,
  translateAiApiKeyInput,
  translateAiEndpointInput,
  translateAiModelInput,
  translateAiRequestTypeSelect,
  translateCurrentPageBtn,
  translateDisplayModeSelect,
  translateEnableToggle,
  translateEngineSelect,
  translateStreamingToggle,
  translateTargetLangSelect,
  translateToggleBtn,
  translationAdvancedToggle,
  translationManager,
  updateBookmarkIcon,
  updateZoomUI,
  zoomInBtn,
  zoomLevelText,
  zoomOutBtn,
  zoomResetBtn
});

bindNavigationAndDevtoolsEvents({
  backBtn,
  browserManager,
  clearUrlBtn,
  devtoolsBtn,
  documentRef: document,
  forwardBtn,
  goBtn,
  homeBtn,
  ipcRenderer,
  newTabBtn,
  refreshBtn,
  store,
  tabManager,
  tabsBar,
  urlInput,
  webviewsContainer,
  windowRef: window
});
