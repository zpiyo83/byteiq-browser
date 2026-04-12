/**
 * 设置与面板事件入口
 * 编排子模块：AI设置、浏览器设置、更多菜单
 */

const { bindAiSettingsEvents } = require('./ai-settings-events');
const { bindBrowserSettingsEvents } = require('./browser-settings-events');

function bindSettingsAndPanelEvents(options) {
  const {
    documentRef,
    ipcRenderer,
    store,
    moreMenuBtn,
    moreMenuDropdown,
    settingsPanel,
    overlayManager
  } = options;

  const document = documentRef;

  // 绑定AI设置事件
  const aiSettingsHelpers = bindAiSettingsEvents({
    aiApiKeyInput: options.aiApiKeyInput,
    aiEndpointInput: options.aiEndpointInput,
    aiModelIdInput: options.aiModelIdInput,
    aiModelListSelect: options.aiModelListSelect,
    aiModelListStatus: options.aiModelListStatus,
    aiModelRefreshBtn: options.aiModelRefreshBtn,
    aiRequestTypeSelect: options.aiRequestTypeSelect,
    aiContextSizeInput: options.aiContextSizeInput,
    aiTimeoutInput: options.aiTimeoutInput,
    ipcRenderer,
    store,
    documentRef,
    translationApiEnabledToggle: options.translationApiEnabledToggle,
    translationApiKeyInput: options.translationApiKeyInput,
    translationConcurrencyCountInput: options.translationConcurrencyCountInput,
    translationConcurrencyToggle: options.translationConcurrencyToggle,
    translationDynamicEnabledToggle: options.translationDynamicEnabledToggle,
    translationEndpointInput: options.translationEndpointInput,
    translationMaxCharsInput: options.translationMaxCharsInput,
    translationMaxTextsInput: options.translationMaxTextsInput,
    translationModelIdInput: options.translationModelIdInput,
    translationRequestTypeSelect: options.translationRequestTypeSelect,
    translationStreamingToggle: options.translationStreamingToggle,
    translationTargetLanguageSelect: options.translationTargetLanguageSelect,
    translationTimeoutInput: options.translationTimeoutInput
  });

  // 绑定浏览器设置事件
  bindBrowserSettingsEvents({
    bookmarkBtn: options.bookmarkBtn,
    bookmarksList: options.bookmarksList,
    bookmarksPanel: options.bookmarksPanel,
    bookmarksSearchInput: options.bookmarksSearchInput,
    browserManager: options.browserManager,
    clearDataBtn: options.clearDataBtn,
    darkModeToggle: options.darkModeToggle,
    documentRef,
    exportAiHistoryBtn: options.exportAiHistoryBtn,
    exportDataBtn: options.exportDataBtn,
    historyList: options.historyList,
    historyPanel: options.historyPanel,
    historyPanelManager: options.historyPanelManager,
    historySearchInput: options.historySearchInput,
    incognitoToggleBtn: options.incognitoToggleBtn,
    ipcRenderer,
    listPanelManager: options.listPanelManager,
    modalManager: options.modalManager,
    overlayBackdrop: options.overlayBackdrop,
    overlayManager,
    restoreSessionToggle: options.restoreSessionToggle,
    searchEngineSelect: options.searchEngineSelect,
    setLocale: options.setLocale,
    startupUrlInput: options.startupUrlInput,
    store,
    tabManager: options.tabManager,
    updateBookmarkIcon: options.updateBookmarkIcon,
    updateZoomUI: options.updateZoomUI,
    zoomInBtn: options.zoomInBtn,
    zoomOutBtn: options.zoomOutBtn,
    zoomResetBtn: options.zoomResetBtn
  });

  // 更多按钮下拉菜单事件处理
  if (moreMenuBtn && moreMenuDropdown) {
    moreMenuBtn.addEventListener('click', e => {
      e.stopPropagation();
      moreMenuDropdown.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      moreMenuDropdown.classList.remove('show');
    });

    moreMenuDropdown.addEventListener('click', e => {
      e.stopPropagation();
    });

    // 下拉菜单内的按钮点击事件
    const historyBtnInMenu = moreMenuDropdown.querySelector('#history-btn');
    const bookmarksBtnInMenu = moreMenuDropdown.querySelector('#bookmarks-list-btn');
    const devtoolsBtnInMenu = moreMenuDropdown.querySelector('#devtools-btn');
    const settingsBtnInMenu = moreMenuDropdown.querySelector('#settings-btn');
    const downloadsBtnInMenu = moreMenuDropdown.querySelector('#downloads-btn');

    if (historyBtnInMenu) {
      historyBtnInMenu.addEventListener('click', () => {
        moreMenuDropdown.classList.remove('show');
        options.historyPanelManager.showPanel(
          options.historyPanel,
          options.historyList,
          options.historySearchInput?.value || ''
        );
        overlayManager.openOverlay(options.historyPanel);
      });
    }

    if (bookmarksBtnInMenu) {
      bookmarksBtnInMenu.addEventListener('click', () => {
        moreMenuDropdown.classList.remove('show');
        options.listPanelManager.showPanel(
          options.bookmarksPanel,
          options.bookmarksList,
          'bookmarks',
          options.bookmarksSearchInput?.value || ''
        );
        overlayManager.openOverlay(options.bookmarksPanel);
      });
    }

    if (devtoolsBtnInMenu) {
      devtoolsBtnInMenu.addEventListener('click', () => {
        moreMenuDropdown.classList.remove('show');
        const wv = document.getElementById(`webview-${options.tabManager.getActiveTabId()}`);
        if (wv) wv.openDevTools();
      });
    }

    if (settingsBtnInMenu) {
      settingsBtnInMenu.addEventListener('click', () => {
        moreMenuDropdown.classList.remove('show');
        // 加载设置值
        const langSelect = document.getElementById('lang-select');
        options.searchEngineSelect.value = store.get('settings.searchEngine', 'bing');
        options.startupUrlInput.value = store.get('settings.startupUrl', '');
        if (options.restoreSessionToggle) {
          options.restoreSessionToggle.checked = store.get('settings.restoreSession', false);
        }
        if (langSelect) {
          langSelect.value = store.get('settings.language', 'zh-CN');
        }
        // 加载 AI 设置
        options.aiEndpointInput.value = store.get('settings.aiEndpoint', '');
        options.aiApiKeyInput.value = store.get('settings.aiApiKey', '');
        options.aiRequestTypeSelect.value = store.get('settings.aiRequestType', 'openai-chat');
        if (options.aiModelIdInput) {
          options.aiModelIdInput.value = store.get('settings.aiModelId', 'gpt-3.5-turbo');
        }
        if (options.aiModelListSelect) {
          aiSettingsHelpers.syncAiModelSelection();
          if (options.aiModelListSelect.options.length <= 1) {
            aiSettingsHelpers.setAiModelStatus('等待获取', '');
          }
        }
        if (options.aiContextSizeInput) {
          const ctxSize = store.get('settings.aiContextSize', 8192);
          options.aiContextSizeInput.value = ctxSize;
        }
        if (options.aiTimeoutInput) {
          const timeout = store.get('settings.aiTimeout', 120);
          options.aiTimeoutInput.value = timeout;
        }
        // 加载翻译设置
        if (options.translationApiEnabledToggle) {
          options.translationApiEnabledToggle.checked = store.get(
            'settings.translationApiEnabled',
            false
          );
        }
        if (options.translationEndpointInput) {
          options.translationEndpointInput.value = store.get('settings.translationEndpoint', '');
        }
        if (options.translationApiKeyInput) {
          options.translationApiKeyInput.value = store.get('settings.translationApiKey', '');
        }
        if (options.translationRequestTypeSelect) {
          options.translationRequestTypeSelect.value = store.get(
            'settings.translationRequestType',
            'openai-chat'
          );
        }
        if (options.translationModelIdInput) {
          options.translationModelIdInput.value = store.get(
            'settings.translationModelId',
            'gpt-3.5-turbo'
          );
        }
        if (options.translationTargetLanguageSelect) {
          options.translationTargetLanguageSelect.value = store.get(
            'settings.translationTargetLanguage',
            '简体中文'
          );
        }
        if (options.translationDynamicEnabledToggle) {
          options.translationDynamicEnabledToggle.checked = store.get(
            'settings.translationDynamicEnabled',
            true
          );
        }
        if (options.translationStreamingToggle) {
          options.translationStreamingToggle.checked = store.get(
            'settings.translationStreaming',
            true
          );
        }
        if (options.translationConcurrencyToggle) {
          options.translationConcurrencyToggle.checked = store.get(
            'settings.translationConcurrencyEnabled',
            false
          );
        }
        if (options.translationConcurrencyCountInput) {
          options.translationConcurrencyCountInput.value = store.get(
            'settings.translationConcurrency',
            2
          );
        }
        if (options.translationMaxTextsInput) {
          options.translationMaxTextsInput.value = store.get('settings.translationMaxTexts', 500);
        }
        if (options.translationMaxCharsInput) {
          options.translationMaxCharsInput.value = store.get('settings.translationMaxChars', 50000);
        }
        if (options.translationTimeoutInput) {
          options.translationTimeoutInput.value = store.get('settings.translationTimeout', 120);
        }
        // 获取版本信息
        ipcRenderer.invoke('get-version-info').then(versions => {
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
        options.extensionsManager.refresh();
        overlayManager.openOverlay(settingsPanel);
      });
    }

    if (downloadsBtnInMenu) {
      downloadsBtnInMenu.addEventListener('click', () => {
        moreMenuDropdown.classList.remove('show');
        options.downloadsManager.openDownloadsPanel();
      });
    }
  }
}

module.exports = {
  bindSettingsAndPanelEvents
};
