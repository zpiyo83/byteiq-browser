/**
 * DOM 引用收集
 */

function getDomReferences(documentRef) {
  return {
    urlInput: documentRef.getElementById('url-input'),
    backBtn: documentRef.getElementById('back-btn'),
    forwardBtn: documentRef.getElementById('forward-btn'),
    refreshBtn: documentRef.getElementById('refresh-btn'),
    homeBtn: documentRef.getElementById('home-btn'),
    historyBtn: documentRef.getElementById('history-btn'),
    bookmarksListBtn: documentRef.getElementById('bookmarks-list-btn'),
    devtoolsBtn: documentRef.getElementById('devtools-btn'),
    settingsBtn: documentRef.getElementById('settings-btn'),
    downloadsBtn: documentRef.getElementById('downloads-btn'),
    bookmarkBtn: documentRef.getElementById('bookmark-btn'),
    clearUrlBtn: documentRef.getElementById('clear-url-btn'),
    progressBar: documentRef.getElementById('progress-bar'),
    historyPanel: documentRef.getElementById('history-panel'),
    settingsPanel: documentRef.getElementById('settings-panel'),
    bookmarksPanel: documentRef.getElementById('bookmarks-panel'),
    downloadsPanel: documentRef.getElementById('downloads-panel'),
    historyList: documentRef.getElementById('history-list'),
    bookmarksList: documentRef.getElementById('bookmarks-list'),
    downloadsList: documentRef.getElementById('downloads-list'),
    historySearchInput: documentRef.getElementById('history-search-input'),
    bookmarksSearchInput: documentRef.getElementById('bookmarks-search-input'),
    downloadsSearchInput: documentRef.getElementById('downloads-search-input'),
    downloadsFilters: documentRef.getElementById('downloads-filters'),
    downloadsClearAllBtn: documentRef.getElementById('downloads-clear-all-btn'),
    downloadsClearCompletedBtn: documentRef.getElementById('downloads-clear-completed-btn'),
    downloadsClearFailedBtn: documentRef.getElementById('downloads-clear-failed-btn'),
    searchEngineSelect: documentRef.getElementById('search-engine-select'),
    startupUrlInput: documentRef.getElementById('startup-url-input'),
    incognitoToggleBtn: documentRef.getElementById('incognito-toggle-btn'),
    darkModeToggle: documentRef.getElementById('dark-mode-toggle'),
    zoomInBtn: documentRef.getElementById('zoom-in-btn'),
    zoomOutBtn: documentRef.getElementById('zoom-out-btn'),
    zoomResetBtn: documentRef.getElementById('zoom-reset-btn'),
    zoomLevelText: documentRef.getElementById('zoom-level-text'),
    clearDataBtn: documentRef.getElementById('clear-data-btn'),
    exportDataBtn: documentRef.getElementById('export-data-btn'),
    restoreSessionToggle: documentRef.getElementById('restore-session-toggle'),
    extensionsList: documentRef.getElementById('extensions-list'),
    extensionsAddBtn: documentRef.getElementById('extensions-add-btn'),
    extensionsRefreshBtn: documentRef.getElementById('extensions-refresh-btn'),
    extensionsEmpty: documentRef.getElementById('extensions-empty'),
    aiEndpointInput: documentRef.getElementById('ai-endpoint-input'),
    aiApiKeyInput: documentRef.getElementById('ai-api-key-input'),
    aiRequestTypeSelect: documentRef.getElementById('ai-request-type-select'),
    aiModelIdInput: documentRef.getElementById('ai-model-id-input'),
    translationApiEnabledToggle: documentRef.getElementById('translation-api-enabled-toggle'),
    translationEndpointInput: documentRef.getElementById('translation-endpoint-input'),
    translationApiKeyInput: documentRef.getElementById('translation-api-key-input'),
    translationRequestTypeSelect: documentRef.getElementById(
      'translation-request-type-select'
    ),
    translationModelIdInput: documentRef.getElementById('translation-model-id-input'),
    translationTargetLanguageSelect: documentRef.getElementById(
      'translation-target-language-select'
    ),
    translationDynamicEnabledToggle: documentRef.getElementById(
      'translation-dynamic-enabled-toggle'
    ),
    translationStreamingToggle: documentRef.getElementById('translation-streaming-toggle'),
    translationConcurrencyToggle: documentRef.getElementById('translation-concurrency-toggle'),
    translationConcurrencyCountInput: documentRef.getElementById(
      'translation-concurrency-count-input'
    ),
    translationMaxTextsInput: documentRef.getElementById('translation-max-texts-input'),
    translationMaxCharsInput: documentRef.getElementById('translation-max-chars-input'),
    translationTimeoutInput: documentRef.getElementById('translation-timeout-input'),
    tabsBar: documentRef.getElementById('tabs-bar'),
    newTabBtn: documentRef.getElementById('new-tab-btn'),
    webviewsContainer: documentRef.getElementById('webviews-container'),
    newTabTemplate: documentRef.getElementById('new-tab-template'),
    aiSidebar: documentRef.getElementById('ai-sidebar'),
    toggleAiBtn: documentRef.getElementById('toggle-ai-btn'),
    closeAiBtn: documentRef.getElementById('close-ai-btn'),
    aiInput: documentRef.getElementById('ai-input'),
    aiSendBtn: documentRef.getElementById('ai-send-btn'),
    aiChatArea: documentRef.getElementById('ai-chat-area'),
    findBox: documentRef.getElementById('find-box'),
    findInput: documentRef.getElementById('find-input'),
    findResults: documentRef.getElementById('find-results'),
    findPrev: documentRef.getElementById('find-prev'),
    findNext: documentRef.getElementById('find-next'),
    findClose: documentRef.getElementById('find-close'),
    contextMenu: documentRef.getElementById('context-menu'),
    tabContextMenu: documentRef.getElementById('tab-context-menu'),
    overlayBackdrop: documentRef.getElementById('overlay-backdrop'),
    moreMenuBtn: documentRef.getElementById('more-menu-btn'),
    moreMenuDropdown: documentRef.getElementById('more-menu-dropdown')
  };
}

module.exports = {
  getDomReferences
};
