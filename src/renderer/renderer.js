// Electron 渲染进程入口文件
const { ipcRenderer, clipboard } = require('electron');
const Store = require('electron-store');
const { initI18n, t, setLocale } = require('./i18n');
const { createBrowserManager } = require('./modules/navigation/browser-manager');
const { createContextMenuManager } = require('./modules/ui/context-menu-manager');
const { createDownloadsManager } = require('./modules/downloads/downloads-manager');
const { createAiManager } = require('./modules/ui/ai-manager');
const { createFindManager } = require('./modules/ui/find-manager');
const { createListPanelManager } = require('./modules/ui/list-panel-manager');
const { createHistoryPanelManager } = require('./modules/ui/history-panel-manager');
const { createOverlayManager } = require('./modules/ui/overlay-manager');
const { createShortcutsManager } = require('./modules/ui/shortcuts-manager');
const { createTabManager } = require('./modules/tabs/tab-manager');
const { createExtensionsManager } = require('./modules/extensions/extensions-manager');
const { createTranslationManager } = require('./modules/ui/translation-manager');
const modalManager = require('./modules/ui/modal-manager');
const store = new Store();
const { getDomReferences } = require('./modules/app/dom-references');
const { bindSettingsAndPanelEvents } = require('./modules/app/events/settings-and-panels-events');
const {
  bindNavigationAndDevtoolsEvents
} = require('./modules/app/events/navigation-and-devtools-events');

// 尽早应用深色模式，避免页面闪烁
if (store.get('settings.darkMode') === true) {
  document.body.classList.add('dark-mode');
}

const domRefs = getDomReferences(document);
const {
  urlInput,
  backBtn,
  forwardBtn,
  refreshBtn,
  homeBtn,
  historyBtn,
  bookmarksListBtn,
  devtoolsBtn,
  settingsBtn,
  downloadsBtn,
  bookmarkBtn,
  clearUrlBtn,
  progressBar,
  historyPanel,
  settingsPanel,
  bookmarksPanel,
  downloadsPanel,
  historyList,
  bookmarksList,
  downloadsList,
  historySearchInput,
  bookmarksSearchInput,
  downloadsSearchInput,
  downloadsFilters,
  downloadsClearAllBtn,
  downloadsClearCompletedBtn,
  downloadsClearFailedBtn,
  searchEngineSelect,
  startupUrlInput,
  incognitoToggleBtn,
  darkModeToggle,
  zoomInBtn,
  zoomOutBtn,
  zoomResetBtn,
  zoomLevelText,
  clearDataBtn,
  exportDataBtn,
  restoreSessionToggle,
  extensionsList,
  extensionsAddBtn,
  extensionsRefreshBtn,
  extensionsEmpty,
  aiEndpointInput,
  aiApiKeyInput,
  aiRequestTypeSelect,
  aiModelIdInput,
  aiModelRefreshBtn,
  aiModelListSelect,
  aiModelListStatus,
  translationApiEnabledToggle,
  translationEndpointInput,
  translationApiKeyInput,
  translationRequestTypeSelect,
  translationModelIdInput,
  translationTargetLanguageSelect,
  translationDynamicEnabledToggle,
  translationStreamingToggle,
  translationConcurrencyToggle,
  translationConcurrencyCountInput,
  translationMaxTextsInput,
  translationMaxCharsInput,
  translationTimeoutInput,
  tabsBar,
  newTabBtn,
  webviewsContainer,
  newTabTemplate,
  aiSidebar,
  toggleAiBtn,
  closeAiBtn,
  aiInput,
  aiSendBtn,
  aiChatArea,
  findBox,
  findInput,
  findResults,
  findPrev,
  findNext,
  findClose,
  contextMenu,
  tabContextMenu,
  overlayBackdrop,
  moreMenuBtn,
  moreMenuDropdown
} = domRefs;

// 全局状态变量
let isIncognito = false; // 隐私模式状态
let browserManager = null; // 浏览器管理器实例
let translationManager = null;

// 初始化国际化
initI18n();

// 初始化模态框管理器
modalManager.init();

// 创建覆盖层管理器
const overlayManager = createOverlayManager({
  documentRef: document,
  overlayBackdrop
});

// Toast 提示功能
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

// 更新书签图标状态
function updateBookmarkIcon(url) {
  const bookmarks = store.get('bookmarks', []);
  const isBookmarked = bookmarks.some(item => item.url === url);
  const bookmarkSvg = document.getElementById('bookmark-svg');
  if (bookmarkSvg) {
    bookmarkSvg.classList.toggle('active', isBookmarked);
  }
}

// 创建标签页管理器
const tabManager = createTabManager({
  applyStoredZoom: webview => {
    if (browserManager) {
      browserManager.applyStoredZoom(webview);
    }
  },
  documentRef: document,
  findResults,
  formatUrl: url => {
    return browserManager ? browserManager.formatUrl(url) : url;
  },
  getIncognito: () => isIncognito,
  initI18n,
  ipcRenderer,
  newTabBtn,
  newTabTemplate,
  onWebviewDidStopLoading: (webview, tabId) => {
    if (translationManager && typeof translationManager.onWebviewDidStopLoading === 'function') {
      translationManager.onWebviewDidStopLoading(webview, tabId);
    }
    if (aiManager && typeof aiManager.onPageChanged === 'function') {
      aiManager.onPageChanged(tabId, webview.getURL?.() || '');
    }
  },
  onWebviewUrlChanged: payload => {
    if (translationManager && typeof translationManager.onWebviewUrlChanged === 'function') {
      translationManager.onWebviewUrlChanged(payload);
    }
    if (aiManager && typeof aiManager.onPageChanged === 'function') {
      aiManager.onPageChanged(payload.id, payload.url);
    }
  },
  onActiveWebviewChanged: webview => {
    if (browserManager) {
      browserManager.onActiveWebviewChanged(webview);
    }
    if (translationManager && typeof translationManager.onActiveTabChanged === 'function') {
      translationManager.onActiveTabChanged(tabManager.getActiveTabId());
    }
    if (aiManager && typeof aiManager.onTabChanged === 'function') {
      aiManager.onTabChanged(tabManager.getActiveTabId());
    }
  },
  onTabClosed: tabId => {
    if (translationManager && typeof translationManager.clearTabState === 'function') {
      translationManager.clearTabState(tabId);
    }
    if (aiManager && typeof aiManager.clearTabConversation === 'function') {
      aiManager.clearTabConversation(tabId);
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

// 更新缩放级别UI显示
function updateZoomUI(level) {
  zoomLevelText.innerText = `${Math.round(level * 100)}%`;
}

// 创建浏览器管理器
browserManager = createBrowserManager({
  documentRef: document,
  getActiveTabId: tabManager.getActiveTabId,
  getIncognito: () => isIncognito,
  setIncognito: value => {
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
  openDownloadPath: path => {
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
  toggleAiBtn,
  ipcRenderer,
  store,
  showToast,
  tabManager,
  formatUrl: browserManager ? browserManager.formatUrl : url => url
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

const historyPanelManager = createHistoryPanelManager({
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

extensionsManager.init();

translationManager = createTranslationManager({
  documentRef: document,
  store,
  t,
  showToast,
  ipcRenderer,
  getActiveTabId: tabManager.getActiveTabId
});

translationManager.bindEvents();

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
      historyPanelManager.showPanel(historyPanel, historyList, historySearchInput?.value || '');
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

// 关闭所有面板
function closeAllPanels() {
  overlayManager.closeAllOverlays();

  if (findBox && findBox.style.display === 'flex') {
    findManager.closeFind();
  }

  contextMenuManager.hideContextMenus();

  if (aiSidebar && !aiSidebar.classList.contains('collapsed')) {
    aiSidebar.classList.add('collapsed');
    const wvc = document.getElementById('webviews-container');
    if (wvc) wvc.style.marginRight = '';
  }
}

// 刷新当前页面
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
  aiModelListSelect,
  aiModelListStatus,
  aiModelIdInput,
  aiModelRefreshBtn,
  aiRequestTypeSelect,
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
  historyPanelManager,
  historySearchInput,
  incognitoToggleBtn,
  ipcRenderer,
  listPanelManager,
  modalManager,
  moreMenuBtn,
  moreMenuDropdown,
  overlayBackdrop,
  overlayManager,
  restoreSessionToggle,
  searchEngineSelect,
  setLocale,
  settingsPanel,
  settingsBtn,
  startupUrlInput,
  store,
  tabManager,
  translationApiEnabledToggle,
  translationApiKeyInput,
  translationDynamicEnabledToggle,
  translationEndpointInput,
  translationConcurrencyCountInput,
  translationConcurrencyToggle,
  translationMaxCharsInput,
  translationMaxTextsInput,
  translationModelIdInput,
  translationRequestTypeSelect,
  translationStreamingToggle,
  translationTargetLanguageSelect,
  translationTimeoutInput,
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
