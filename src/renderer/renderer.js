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
const { createOverlayManager } = require('./modules/ui/overlay-manager');
const { createShortcutsManager } = require('./modules/ui/shortcuts-manager');
const { createTabManager } = require('./modules/tabs/tab-manager');
const { createExtensionsManager } = require('./modules/extensions/extensions-manager');
const modalManager = require('./modules/ui/modal-manager');
const store = new Store();
const { bindSettingsAndPanelEvents } = require('./modules/app/events/settings-and-panels-events');
const {
  bindNavigationAndDevtoolsEvents
} = require('./modules/app/events/navigation-and-devtools-events');

// 尽早应用深色模式，避免页面闪烁
if (store.get('settings.darkMode')) {
  document.body.classList.add('dark-mode');
}

// DOM 元素引用
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
const bookmarkBtn = document.getElementById('bookmark-btn');
const clearUrlBtn = document.getElementById('clear-url-btn');
const progressBar = document.getElementById('progress-bar');
// 面板相关元素
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
// 设置相关元素
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
// 扩展和翻译相关元素
const extensionsList = document.getElementById('extensions-list');
const extensionsAddBtn = document.getElementById('extensions-add-btn');
const extensionsRefreshBtn = document.getElementById('extensions-refresh-btn');
const extensionsEmpty = document.getElementById('extensions-empty');
const aiEndpointInput = document.getElementById('ai-endpoint-input');
const aiApiKeyInput = document.getElementById('ai-api-key-input');
const aiRequestTypeSelect = document.getElementById('ai-request-type-select');
// 标签页和webview相关元素
const tabsBar = document.getElementById('tabs-bar');
const newTabBtn = document.getElementById('new-tab-btn');
const webviewsContainer = document.getElementById('webviews-container');
const newTabTemplate = document.getElementById('new-tab-template');
// AI 助手相关元素
const aiSidebar = document.getElementById('ai-sidebar');
const toggleAiBtn = document.getElementById('toggle-ai-btn');
const closeAiBtn = document.getElementById('close-ai-btn');
const aiInput = document.getElementById('ai-input');
const aiSendBtn = document.getElementById('ai-send-btn');
const aiChatArea = document.getElementById('ai-chat-area');
// 查找和上下文菜单相关元素
const findBox = document.getElementById('find-box');
const findInput = document.getElementById('find-input');
const findResults = document.getElementById('find-results');
const findPrev = document.getElementById('find-prev');
const findNext = document.getElementById('find-next');
const findClose = document.getElementById('find-close');
const contextMenu = document.getElementById('context-menu');
const tabContextMenu = document.getElementById('tab-context-menu');
const overlayBackdrop = document.getElementById('overlay-backdrop');

// 全局状态变量
let isIncognito = false; // 隐私模式状态
let browserManager = null; // 浏览器管理器实例

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
  onActiveWebviewChanged: webview => {
    if (browserManager) {
      browserManager.onActiveWebviewChanged(webview);
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

// 关闭所有面板
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
  settingsPanel,
  settingsBtn,
  startupUrlInput,
  store,
  tabManager,
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
