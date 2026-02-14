const { ipcRenderer, clipboard } = require('electron');
const Store = require('electron-store');
const store = new Store();
const { initI18n, t, setLocale } = require('./i18n');

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
const searchEngineSelect = document.getElementById('search-engine-select');
const startupUrlInput = document.getElementById('startup-url-input');
const incognitoToggleBtn = document.getElementById('incognito-toggle-btn');
const darkModeBtn = document.getElementById('dark-mode-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomResetBtn = document.getElementById('zoom-reset-btn');
const zoomLevelText = document.getElementById('zoom-level-text');
const clearDataBtn = document.getElementById('clear-data-btn');
const exportDataBtn = document.getElementById('export-data-btn');
const restoreSessionToggle = document.getElementById('restore-session-toggle');
const tabsBar = document.getElementById('tabs-bar');
const newTabBtn = document.getElementById('new-tab-btn');

let lastClosedTabs = [];
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

let tabs = [];
let activeTabId = null;
let isRestoringSession = false;
let tabContextTargetId = null;

// Initialize i18n
initI18n();

toggleAiBtn.style.display = 'flex';

// Language selection
const langSelect = document.getElementById('lang-select');
if (langSelect) {
    langSelect.value = store.get('settings.language', 'zh-CN');
    langSelect.addEventListener('change', () => {
        setLocale(langSelect.value);
    });
}

// Toast 通知系统
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

function getActiveOverlayPanel() {
    return document.querySelector('.overlay-panel.active');
}

function setOverlayBackdropActive(active) {
    if (!overlayBackdrop) return;
    overlayBackdrop.classList.toggle('active', active);
}

function closeAllOverlays() {
    document.querySelectorAll('.overlay-panel').forEach(p => {
        p.classList.remove('active');
    });
    setOverlayBackdropActive(false);
}

function openOverlay(panelEl) {
    if (!panelEl) return;
    document.querySelectorAll('.overlay-panel').forEach(p => {
        if (p !== panelEl) p.classList.remove('active');
    });
    panelEl.classList.add('active');
    setOverlayBackdropActive(true);

    requestAnimationFrame(() => {
        const search = panelEl.querySelector('.panel-search input');
        if (search) {
            search.focus();
            return;
        }
        const firstInput = panelEl.querySelector('input');
        if (firstInput) {
            firstInput.focus();
        }
    });
}

if (restoreSessionToggle) {
    restoreSessionToggle.checked = store.get('settings.restoreSession', true);
    restoreSessionToggle.addEventListener('change', () => {
        store.set('settings.restoreSession', restoreSessionToggle.checked);
    });
}

// AI Sidebar Logic
toggleAiBtn.addEventListener('click', () => {
    aiSidebar.classList.toggle('collapsed');
});

closeAiBtn.addEventListener('click', () => {
    aiSidebar.classList.add('collapsed');
});

function addChatMessage(text, sender) {
    const msg = document.createElement('div');
    msg.className = `chat-message ${sender}`;
    msg.innerText = text;
    aiChatArea.appendChild(msg);
    aiChatArea.scrollTop = aiChatArea.scrollHeight;
}

function handleAISend() {
    const text = aiInput.value.trim();
    if (!text) return;

    addChatMessage(text, 'user');
    aiInput.value = '';

    // Simulate AI response
    setTimeout(() => {
        const currentWv = document.getElementById(`webview-${activeTabId}`);
        let response = t('ai.prototype');
        
        if (
            text.includes('总结') ||
            text.includes('總結') ||
            text.includes('summary')
        ) {
            if (currentWv && currentWv.tagName === 'WEBVIEW') {
                response = t('ai.summaryPrompt');
            } else {
                response = t('ai.noPage');
            }
        }
        
        addChatMessage(response, 'ai');
    }, 600);
}

aiSendBtn.addEventListener('click', handleAISend);
aiInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAISend();
});

function getTabById(id) {
    return tabs.find((tab) => tab.id === id);
}

function updateTabUrl(id, url) {
    const tab = getTabById(id);
    if (!tab) return;
    tab.url = url;
    saveSession();
}

function saveSession() {
    if (isRestoringSession) return;
    const sessionTabs = tabs.map((tab) => ({
        url: tab.url || '',
        pinned: !!tab.pinned
    }));
    const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
    store.set('session.tabs', sessionTabs);
    store.set('session.activeIndex', activeIndex);
}

function restoreSession() {
    const shouldRestore = store.get('settings.restoreSession', true);
    if (!shouldRestore) {
        createTab();
        return;
    }

    const sessionTabs = store.get('session.tabs', []);
    if (!Array.isArray(sessionTabs) || sessionTabs.length === 0) {
        createTab();
        return;
    }

    isRestoringSession = true;
    sessionTabs.forEach((tabInfo) => {
        const tabUrl = typeof tabInfo === 'string' ? tabInfo : tabInfo.url;
        const pinned = typeof tabInfo === 'object' && tabInfo.pinned;
        createTab(tabUrl || null, {
            activate: false,
            useStartup: false,
            skipSession: true,
            pinned
        });
    });

    const activeIndex = store.get('session.activeIndex', 0);
    const targetTab = tabs[activeIndex] || tabs[0];
    if (targetTab) {
        switchTab(targetTab.id);
    }
    isRestoringSession = false;
    saveSession();
}

function renderTabOrder() {
    const pinnedTabs = tabs.filter((tab) => tab.pinned);
    const normalTabs = tabs.filter((tab) => !tab.pinned);
    const orderedTabs = pinnedTabs.concat(normalTabs);

    orderedTabs.forEach((tab, index) => {
        const tabEl = document.getElementById(`tab-${tab.id}`);
        if (tabEl) {
            tabEl.style.order = index;
        }
    });

    if (newTabBtn) {
        newTabBtn.style.order = orderedTabs.length + 1;
    }
}

function setTabPinned(id, pinned) {
    const tab = getTabById(id);
    if (!tab) return;
    tab.pinned = pinned;

    const tabEl = document.getElementById(`tab-${id}`);
    if (tabEl) {
        tabEl.classList.toggle('pinned', pinned);
    }
    renderTabOrder();
    saveSession();
}

function setTabLoading(id, isLoading) {
    const tab = getTabById(id);
    if (tab) {
        tab.loading = isLoading;
    }
    const tabEl = document.getElementById(`tab-${id}`);
    if (tabEl) {
        tabEl.classList.toggle('loading', isLoading);
    }
}

function setTabIcon(id, iconUrl) {
    const tabEl = document.getElementById(`tab-${id}`);
    if (!tabEl) return;
    const iconEl = tabEl.querySelector('.tab-icon');
    if (!iconEl) return;

    if (iconUrl) {
        iconEl.src = iconUrl;
        iconEl.classList.add('visible');
    } else {
        iconEl.removeAttribute('src');
        iconEl.classList.remove('visible');
    }
}

function getHostFromUrl(url) {
    try {
        return new URL(url).host;
    } catch (error) {
        return '';
    }
}

function getZoomForUrl(url) {
    const host = getHostFromUrl(url);
    if (!host) return null;
    const zoomByHost = store.get('zoomByHost', {});
    return zoomByHost[host] || null;
}

function setZoomForUrl(url, factor) {
    const host = getHostFromUrl(url);
    if (!host) return;
    const zoomByHost = store.get('zoomByHost', {});
    zoomByHost[host] = factor;
    store.set('zoomByHost', zoomByHost);
}

function syncZoomUI(webview) {
    if (!webview || webview.tagName !== 'WEBVIEW') return;
    webview.getZoomFactor((factor) => {
        updateZoomUI(factor);
    });
}

function applyStoredZoom(webview) {
    if (!webview || webview.tagName !== 'WEBVIEW') return;
    const storedZoom = getZoomForUrl(webview.getURL());
    if (storedZoom) {
        webview.setZoomFactor(storedZoom);
        if (webview.id === `webview-${activeTabId}`) {
            updateZoomUI(storedZoom);
        }
        return;
    }
    if (webview.id === `webview-${activeTabId}`) {
        syncZoomUI(webview);
    }
}

function openDownloadPath(path) {
    if (path) {
        ipcRenderer.send('open-download-path', path);
    }
}

function hideContextMenus() {
    if (contextMenu) {
        contextMenu.style.display = 'none';
    }
    if (tabContextMenu) {
        tabContextMenu.style.display = 'none';
    }
}

function showTabContextMenu(x, y, id) {
    if (!tabContextMenu) return;
    const tab = getTabById(id);
    if (!tab) return;

    tabContextTargetId = id;
    const pinItem = tabContextMenu.querySelector('[data-action="pin"]');
    const unpinItem = tabContextMenu.querySelector('[data-action="unpin"]');
    if (pinItem) {
        pinItem.style.display = tab.pinned ? 'none' : 'block';
    }
    if (unpinItem) {
        unpinItem.style.display = tab.pinned ? 'block' : 'none';
    }

    tabContextMenu.style.top = `${y}px`;
    tabContextMenu.style.left = `${x}px`;
    tabContextMenu.style.display = 'block';
}

function getOrderedTabIds() {
    return Array.from(tabsBar.querySelectorAll('.tab')).map((tabEl) => {
        return tabEl.id.replace('tab-', '');
    });
}

function duplicateTab(id) {
    const wv = document.getElementById(`webview-${id}`);
    const url = wv && wv.tagName === 'WEBVIEW' ? wv.getURL() : '';
    createTab(url || null);
}

function closeOtherTabs(id) {
    const idsToClose = tabs
        .map((tab) => tab.id)
        .filter((tabId) => tabId !== id);
    idsToClose.forEach((tabId) => closeTab(tabId));
}

function closeTabsToRight(id) {
    const orderedIds = getOrderedTabIds();
    const index = orderedIds.indexOf(id);
    if (index === -1) return;
    const idsToClose = orderedIds.slice(index + 1);
    idsToClose.forEach((tabId) => closeTab(tabId));
}

function createTab(url = null, options = {}) {
    const {
        activate = true,
        useStartup = true,
        skipSession = false,
        pinned = false
    } = options;
    const startupUrl = useStartup ? store.get('settings.startupUrl', '') : '';
    const targetUrl = url || startupUrl || null;
    const formattedUrl = targetUrl ? formatUrl(targetUrl) : null;

    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const tab = {
        id,
        url: formattedUrl,
        title: t('tabs.newTab'),
        pinned: !!pinned,
        loading: false
    };

    tabs.push(tab);

    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.id = `tab-${id}`;
    tabEl.innerHTML = `
        <span class="tab-content">
            <img class="tab-icon" alt="">
            <span class="tab-spinner"></span>
            <span class="tab-title">${tab.title}</span>
        </span>
        <span class="close-tab">x</span>
    `;
    tabEl.classList.toggle('pinned', tab.pinned);
    tabEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('close-tab')) {
            closeTab(id);
        } else {
            switchTab(id);
        }
    });
    tabEl.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
            closeTab(id);
        }
    });
    tabsBar.insertBefore(tabEl, newTabBtn);
    renderTabOrder();

    if (formattedUrl) {
        const webview = document.createElement('webview');
        webview.id = `webview-${id}`;
        webview.src = formattedUrl;
        webview.setAttribute('allowpopups', '');
        
        if (isIncognito) {
            webview.setAttribute('partition', 'incognito');
        }
        
        webviewsContainer.appendChild(webview);
        setupWebviewEvents(webview, id);
    } else {
        const content = newTabTemplate.content.cloneNode(true);
        const container = document.createElement('div');
        container.className = 'webview-mock';
        container.id = `webview-${id}`;
        container.appendChild(content);
        
        const searchInput = container.querySelector('.tab-search-input');
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value;
                if (query) {
                    navigateTo(query, id);
                }
            }
        });
        
        webviewsContainer.appendChild(container);
        
        if (typeof initI18n === 'function') {
            initI18n(container);
        }
    }

    if (activate) {
        switchTab(id);
    }
    if (!skipSession) {
        saveSession();
    }
    return id;
}

ipcRenderer.on('open-new-tab', (event, url) => {
    if (url) {
        createTab(url);
    }
});
function setupWebviewEvents(webview, id) {
    webview.addEventListener('did-start-loading', () => {
        setTabLoading(id, true);
        if (id === activeTabId) {
            progressBar.style.opacity = '1';
            progressBar.style.width = '30%';
        }
    });

    webview.addEventListener('did-stop-loading', () => {
        setTabLoading(id, false);
        if (id === activeTabId) {
            urlInput.value = webview.getURL();
            progressBar.style.width = '100%';
            setTimeout(() => {
                progressBar.style.opacity = '0';
                setTimeout(() => progressBar.style.width = '0%', 200);
            }, 300);
        }
        updateTabUrl(id, webview.getURL());
        applyStoredZoom(webview);
        updateBookmarkIcon(webview.getURL());
    });

    webview.addEventListener('found-in-page', (e) => {
        const result = e.result;
        if (result.matches !== undefined) {
            findResults.innerText = `${result.activeMatchOrdinal || 0}/${result.matches}`;
        }
    });

    webview.addEventListener('page-favicon-updated', (e) => {
        const icon = e.favicons && e.favicons.length > 0 ? e.favicons[0] : '';
        setTabIcon(id, icon);
    });

    webview.addEventListener('page-title-updated', (e) => {
        const tabEl = document.getElementById(`tab-${id}`);
        if (tabEl) {
            tabEl.querySelector('.tab-title').innerText = e.title;
        }
        const tab = getTabById(id);
        if (tab) {
            tab.title = e.title;
        }
        saveHistory(webview.getURL(), e.title);
    });

    webview.addEventListener('did-navigate', (e) => {
        updateTabUrl(id, e.url);
        applyStoredZoom(webview);
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
        updateTabUrl(id, e.url);
    });

    webview.addEventListener('did-fail-load', (e) => {
        if (e.errorCode !== -3) {
            console.error('Failed to load:', e);
            showToast(
                t('toast.loadFailed') || `页面加载失败: ${e.errorDescription || '未知错误'}`,
                'error'
            );
        }
    });

    webview.addEventListener('new-window', (e) => {
        e.preventDefault();
    });
}

function saveHistory(url, title) {
    if (!url || url === 'about:blank' || url.startsWith('data:')) return;
    let history = store.get('history', []);
    if (history.length > 0 && history[0].url === url) return;
    
    history.unshift({
        url,
        title,
        time: new Date().toISOString()
    });
    
    if (history.length > 1000) history = history.slice(0, 1000);
    store.set('history', history);
}

function switchTab(id) {
    activeTabId = id;
    
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const activeTabEl = document.getElementById(`tab-${id}`);
    if (activeTabEl) activeTabEl.classList.add('active');

    document.querySelectorAll('#webviews-container > *').forEach(w => {
        w.classList.remove('active');
    });
    const activeWebview = document.getElementById(`webview-${id}`);
    if (activeWebview) {
        activeWebview.classList.add('active');
        
        if (activeWebview.tagName === 'WEBVIEW') {
            const url = activeWebview.getURL();
            urlInput.value = url;
            updateBookmarkIcon(url);
            applyStoredZoom(activeWebview);
        } else {
            urlInput.value = '';
            updateBookmarkIcon('');
            updateZoomUI(1.0);
        }
    }
    saveSession();
}

function closeTab(id) {
    const index = tabs.findIndex(t => t.id === id);
    if (index === -1) return;

    const tabData = tabs[index];
    const wv = document.getElementById(`webview-${id}`);
    if (wv && wv.tagName === 'WEBVIEW') {
        lastClosedTabs.push({ url: wv.getURL(), title: tabData.title });
        if (lastClosedTabs.length > 10) lastClosedTabs.shift();
    }

    tabs.splice(index, 1);
    document.getElementById(`tab-${id}`).remove();
    document.getElementById(`webview-${id}`).remove();

    if (activeTabId === id) {
        if (tabs.length > 0) {
            const nextTab = tabs[Math.max(0, index - 1)];
            switchTab(nextTab.id);
        } else {
            createTab();
        }
    }
    renderTabOrder();
    saveSession();
}

function restoreLastTab() {
    if (lastClosedTabs.length > 0) {
        const last = lastClosedTabs.pop();
        createTab(last.url);
        showToast(t('toast.tabRestored') || '标签页已恢复', 'success');
    } else {
        showToast(t('toast.noClosedTabs') || '没有可恢复的标签页', 'warning');
    }
}

// 切换到下一个标签页
function switchToNextTab() {
    const orderedIds = getOrderedTabIds();
    if (orderedIds.length <= 1) return;
    
    const currentIndex = orderedIds.indexOf(activeTabId);
    const nextIndex = (currentIndex + 1) % orderedIds.length;
    switchTab(orderedIds[nextIndex]);
}

// 切换到上一个标签页
function switchToPrevTab() {
    const orderedIds = getOrderedTabIds();
    if (orderedIds.length <= 1) return;
    
    const currentIndex = orderedIds.indexOf(activeTabId);
    const prevIndex = (currentIndex - 1 + orderedIds.length) % orderedIds.length;
    switchTab(orderedIds[prevIndex]);
}

// 关闭所有面板、菜单、查找框
function closeAllPanels() {
    // 关闭所有 overlay 面板
    closeAllOverlays();
    
    // 关闭查找框
    if (findBox && findBox.style.display === 'flex') {
        const wv = document.getElementById(`webview-${activeTabId}`);
        if (wv) wv.stopFindInPage('clearSelection');
        findBox.style.display = 'none';
    }
    
    // 关闭上下文菜单
    hideContextMenus();
    
    // 折叠 AI 侧边栏
    if (aiSidebar && !aiSidebar.classList.contains('collapsed')) {
        aiSidebar.classList.add('collapsed');
    }
}

// 刷新当前页面
function refreshCurrentPage() {
    const wv = document.getElementById(`webview-${activeTabId}`);
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

function formatUrl(url) {
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    if (url.includes('.') && !url.includes(' ')) {
        return 'https://' + url;
    }
    const engine = store.get('settings.searchEngine', 'bing');
    let searchBase = 'https://www.bing.com/search?q=';
    if (engine === 'google') searchBase = 'https://www.google.com/search?q=';
    if (engine === 'baidu') searchBase = 'https://www.baidu.com/s?wd=';
    
    return searchBase + encodeURIComponent(url);
}

function navigateTo(url, id = activeTabId) {
    const formattedUrl = formatUrl(url);
    let container = document.getElementById(`webview-${id}`);
    
    if (container.tagName !== 'WEBVIEW') {
        const webview = document.createElement('webview');
        webview.id = `webview-${id}`;
        webview.src = formattedUrl;
        webview.setAttribute('allowpopups', '');
        
        if (isIncognito) {
            webview.setAttribute('partition', 'incognito');
        }
        
        container.replaceWith(webview);
        setupWebviewEvents(webview, id);
        if (id === activeTabId) {
            webview.classList.add('active');
            urlInput.value = formattedUrl;
        }
        updateTabUrl(id, formattedUrl);
    } else {
        container.src = formattedUrl;
        updateTabUrl(id, formattedUrl);
    }
}

let isIncognito = false;
function toggleIncognito() {
    isIncognito = !isIncognito;
    document.body.classList.toggle('incognito-mode', isIncognito);
    alert(isIncognito ? t('panels.settings.incognitoOn') : t('panels.settings.incognitoOff'));
}

// Bookmarks Logic
function updateBookmarkIcon(url) {
    const bookmarks = store.get('bookmarks', []);
    const isBookmarked = bookmarks.some(b => b.url === url);
    const bookmarkSvg = document.getElementById('bookmark-svg');
    if (bookmarkSvg) {
        bookmarkSvg.classList.toggle('active', isBookmarked);
    }
}

bookmarkBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (!wv || wv.tagName !== 'WEBVIEW') return;
    
    const url = wv.getURL();
    const title = wv.getTitle();
    let bookmarks = store.get('bookmarks', []);
    const index = bookmarks.findIndex(b => b.url === url);

    if (index > -1) {
        bookmarks.splice(index, 1);
    } else {
        bookmarks.unshift({ url, title, time: new Date().toISOString() });
    }
    
    store.set('bookmarks', bookmarks);
    updateBookmarkIcon(url);
});

// Overlay Panels Logic
function showPanel(panel, listContainer, dataKey, filterText = '') {
    const data = store.get(dataKey, []);
    const emptyKey = dataKey === 'history'
        ? 'panels.history.empty'
        : 'panels.bookmarks.empty';
    const query = filterText.trim().toLowerCase();
    const filteredData = query
        ? data.filter((item) => {
            const title = (item.title || '').toLowerCase();
            const url = (item.url || '').toLowerCase();
            return title.includes(query) || url.includes(query);
        })
        : data;
    listContainer.innerHTML = '';

    if (filteredData.length === 0) {
        listContainer.innerHTML =
            `<p style="text-align:center;color:#999;padding:20px;">` +
            `${t(emptyKey)}</p>`;
    }

    filteredData.forEach((item) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'list-item';

        const openLink = document.createElement('a');
        openLink.href = '#';
        openLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (item.url) {
                createTab(item.url);
            }
        });

        const title = document.createElement('strong');
        title.innerText = item.title || t('bookmark.empty');
        openLink.appendChild(title);
        openLink.appendChild(document.createElement('br'));

        const urlText = document.createElement('small');
        urlText.style.color = '#999';
        urlText.innerText = item.url || '';
        openLink.appendChild(urlText);

        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'delete-btn';
        const dataIndex = data.indexOf(item);
        deleteBtn.dataset.index = dataIndex;
        deleteBtn.innerText = t('delete');
        deleteBtn.addEventListener('click', (e) => {
            const idx = Number(e.target.dataset.index);
            data.splice(idx, 1);
            store.set(dataKey, data);
            showPanel(panel, listContainer, dataKey, filterText);
        });

        itemEl.appendChild(openLink);
        itemEl.appendChild(deleteBtn);
        listContainer.appendChild(itemEl);
    });

    panel.classList.add('active');
}

function updateDownloadStore(data) {
    let downloads = store.get('downloads', []);
    const downloadId = data.id || '';
    const index = downloadId
        ? downloads.findIndex((item) => item.id === downloadId)
        : downloads.findIndex((item) => item.fileName === data.fileName);
    const current = index > -1 ? downloads[index] : {};

    const now = Date.now();
    const lastUpdateAt = current.lastUpdateAt || 0;
    const lastReceived = current.lastReceived || 0;
    const received = data.received !== undefined
        ? data.received
        : (current.received || 0);
    const total = data.total !== undefined ? data.total : (current.total || 0);

    let speedBps = current.speedBps || 0;
    let etaSeconds = current.etaSeconds || 0;
    if (
        data.state === 'progressing' &&
        received >= 0 &&
        total > 0 &&
        lastUpdateAt > 0 &&
        now > lastUpdateAt
    ) {
        const deltaBytes = Math.max(0, received - lastReceived);
        const deltaSeconds = Math.max(0.001, (now - lastUpdateAt) / 1000);
        const instant = deltaBytes / deltaSeconds;
        speedBps = speedBps ? (speedBps * 0.75 + instant * 0.25) : instant;
        const remaining = Math.max(0, total - received);
        etaSeconds = speedBps > 1 ? Math.round(remaining / speedBps) : 0;
    }

    const nextItem = {
        id: downloadId || current.id || '',
        fileName: data.fileName,
        received,
        total,
        state: data.state || current.state || 'progressing',
        error: data.error || '',
        savePath: data.savePath || current.savePath || '',
        url: data.url || current.url || '',
        mimeType: data.mimeType || current.mimeType || '',
        paused: data.paused !== undefined ? data.paused : (current.paused || false),
        speedBps,
        etaSeconds,
        lastUpdateAt: now,
        lastReceived: received,
        time: current.time || new Date().toISOString()
    };

    if (index > -1) {
        downloads[index] = nextItem;
    } else {
        downloads.unshift(nextItem);
    }

    if (downloads.length > 200) {
        downloads = downloads.slice(0, 200);
    }

    store.set('downloads', downloads);
}

function renderDownloadsPanel() {
    const downloads = store.get('downloads', []);
    const query = (downloadsSearchInput?.value || '').trim().toLowerCase();
    const activeFilter = store.get('ui.downloadsFilter', 'all');
    
    // 排序：下载中置顶，其他按时间倒序
    const sortedDownloads = [...downloads].sort((a, b) => {
        const aProgressing = a.state === 'progressing';
        const bProgressing = b.state === 'progressing';
        if (aProgressing && !bProgressing) return -1;
        if (!aProgressing && bProgressing) return 1;
        return new Date(b.time || 0) - new Date(a.time || 0);
    });
    
    const filtered = sortedDownloads.filter((item) => {
        if (activeFilter && activeFilter !== 'all') {
            const state = (item.state || '');
            if (activeFilter === 'failed') {
                if (state !== 'failed' && state !== 'cancelled' && state !== 'interrupted') {
                    return false;
                }
            } else if (state !== activeFilter) {
                return false;
            }
        }
        if (!query) return true;
        const name = (item.fileName || '').toLowerCase();
        const url = (item.url || '').toLowerCase();
        const path = (item.savePath || '').toLowerCase();
        return name.includes(query) || url.includes(query) || path.includes(query);
    });
    downloadsList.innerHTML = '';

    if (filtered.length === 0) {
        downloadsList.innerHTML =
            `<p style="text-align:center;color:#999;padding:20px;">` +
            `${t('panels.downloads.empty')}</p>`;
        return;
    }

    filtered.forEach((item) => {
        const index = downloads.indexOf(item);
        const itemEl = document.createElement('div');
        itemEl.className = 'list-item download-item';

        const content = document.createElement('div');
        content.className = 'download-content';

        // 紧凑展示文件名和路径
        const fileInfo = document.createElement('div');
        fileInfo.className = 'download-file-info';
        
        const fileName = document.createElement('span');
        fileName.className = 'download-filename';
        fileName.innerText = item.fileName || 'Unknown';
        fileInfo.appendChild(fileName);

        if (item.savePath) {
            const pathEl = document.createElement('span');
            pathEl.className = 'download-path';
            pathEl.innerText = item.savePath;
            fileInfo.appendChild(pathEl);
        }
        content.appendChild(fileInfo);

        // 下载进度或状态
        if (item.state === 'progressing' && item.total > 0) {
            const percent = Math.round((item.received / item.total) * 100);
            const progress = document.createElement('progress');
            progress.value = percent;
            progress.max = 100;
            progress.className = 'download-progress';
            content.appendChild(progress);

            const detail = document.createElement('div');
            detail.className = 'download-detail';
            detail.innerText = t('status.downloadProgress', {
                percent,
                received: (item.received / 1024 / 1024).toFixed(2),
                total: (item.total / 1024 / 1024).toFixed(2)
            });
            content.appendChild(detail);

            const meta = document.createElement('div');
            meta.className = 'download-meta';
            const speedText = item.speedBps
                ? `${(item.speedBps / 1024 / 1024).toFixed(2)} MB/s`
                : '';
            const etaText = item.etaSeconds
                ? `${item.etaSeconds}s`
                : '';
            const pausedText = item.paused ? t('status.paused') : '';
            meta.innerText = [speedText, etaText, pausedText].filter(Boolean).join(' | ');
            if (meta.innerText) {
                content.appendChild(meta);
            }
        } else {
            const stateInfo = document.createElement('div');
            stateInfo.className = 'download-state-info';

            if (item.state === 'completed') {
                stateInfo.className += ' state-completed';
                stateInfo.innerText = t('status.downloadComplete');
                // 显示完成时间
                if (item.time) {
                    const timeStr = formatDownloadTime(item.time);
                    const timeEl = document.createElement('span');
                    timeEl.className = 'download-time';
                    timeEl.innerText = t('status.completedAt', { time: timeStr });
                    stateInfo.appendChild(document.createElement('br'));
                    stateInfo.appendChild(timeEl);
                }
            } else if (item.state === 'cancelled') {
                stateInfo.className += ' state-cancelled';
                stateInfo.innerText = t('status.downloadCancelled');
            } else if (item.state === 'interrupted') {
                stateInfo.className += ' state-interrupted';
                stateInfo.innerText = t('status.downloadInterrupted');
            } else if (item.state === 'failed') {
                stateInfo.className += ' state-failed';
                const err = item.error || 'unknown';
                stateInfo.innerText = t('status.downloadFailed', { error: err });
            } else {
                stateInfo.innerText = item.state;
            }

            content.appendChild(stateInfo);
        }

        // 显示URL（紧凑）
        if (item.url) {
            const urlEl = document.createElement('div');
            urlEl.className = 'download-url';
            urlEl.innerText = item.url;
            content.appendChild(urlEl);
        }

        const actions = document.createElement('div');
        actions.className = 'download-actions';

        // SVG图标定义
        const icons = {
            // 复制图标
            copy: '<svg viewBox="0 0 24 24" width="16" height="16">' +
                '<path fill="currentColor" d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z"/>' +
                '</svg>',
            // 暂停图标
            pause: '<svg viewBox="0 0 24 24" width="16" height="16">' +
                '<path fill="currentColor" d="M14,19H18V5H14M6,19H10V5H6V19Z"/>' +
                '</svg>',
            // 继续/播放图标
            resume: '<svg viewBox="0 0 24 24" width="16" height="16">' +
                '<path fill="currentColor" d="M8,5.14V19.14L19,12.14L8,5.14Z"/>' +
                '</svg>',
            // 取消/关闭图标
            cancel: '<svg viewBox="0 0 24 24" width="16" height="16">' +
                '<path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>' +
                '</svg>',
            // 重试/刷新图标
            retry: '<svg viewBox="0 0 24 24" width="16" height="16">' +
                '<path fill="currentColor" d="M17.65,6.35C16.2,4.9,14.21,4,12,4c-4.42,0-7.99,3.58-7.99,8s3.57,8,7.99,8c3.73,0,6.84-2.55,7.73-6h-2.08c-0.82,2.33-3.07,4-5.65,4c-3.31,0-6-2.69-6-6s2.69-6,6-6c1.66,0,3.14,0.69,4.22,1.78L13,11h7V4L17.65,6.35z"/>' +
                '</svg>',
            // 打开文件图标
            openFile: '<svg viewBox="0 0 24 24" width="16" height="16">' +
                '<path fill="currentColor" d="M19,20H4C2.89,20 2,19.1 2,18V6C2,4.89 2.89,4 4,4H10L12,6H19A2,2 0 0,1 21,8H21L4,8V18L6.14,10H23.21L20.93,18.5C20.7,19.37 19.92,20 19,20Z"/>' +
                '</svg>',
            // 在文件夹中显示图标
            showInFolder: '<svg viewBox="0 0 24 24" width="16" height="16">' +
                '<path fill="currentColor" d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4M13,10H15V13H18V15H15V18H13V15H10V13H13V10Z"/>' +
                '</svg>',
            // 删除图标
            delete: '<svg viewBox="0 0 24 24" width="16" height="16">' +
                '<path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>' +
                '</svg>'
        };

        // 创建图标按钮的辅助函数
        function createIconButton(className, iconKey, titleText, clickHandler) {
            const btn = document.createElement('button');
            btn.className = className + ' icon-btn';
            btn.innerHTML = icons[iconKey];
            btn.title = titleText;
            btn.addEventListener('click', clickHandler);
            return btn;
        }

        // 复制路径按钮
        if (item.savePath) {
            const copyPathBtn = createIconButton(
                'download-copy-path-btn',
                'copy',
                t('panels.downloads.copyPath'),
                () => { clipboard.writeText(item.savePath); }
            );
            actions.appendChild(copyPathBtn);
        }

        // 复制URL按钮
        if (item.url) {
            const copyUrlBtn = createIconButton(
                'download-copy-url-btn',
                'copy',
                t('panels.downloads.copyUrl'),
                () => { clipboard.writeText(item.url); }
            );
            actions.appendChild(copyUrlBtn);
        }

        if (item.state === 'progressing' && item.id) {
            if (item.paused) {
                const resumeBtn = createIconButton(
                    'download-resume-btn',
                    'resume',
                    t('panels.downloads.resume'),
                    () => { ipcRenderer.send('download-resume', item.id); }
                );
                actions.appendChild(resumeBtn);
            } else {
                const pauseBtn = createIconButton(
                    'download-pause-btn',
                    'pause',
                    t('panels.downloads.pause'),
                    () => { ipcRenderer.send('download-pause', item.id); }
                );
                actions.appendChild(pauseBtn);
            }

            const cancelBtn = createIconButton(
                'download-cancel-btn',
                'cancel',
                t('panels.downloads.cancel'),
                () => { ipcRenderer.send('download-cancel', item.id); }
            );
            actions.appendChild(cancelBtn);
        }

        if (item.state === 'failed' && item.url) {
            const retryBtn = createIconButton(
                'download-retry-btn',
                'retry',
                t('panels.downloads.retry'),
                () => { ipcRenderer.send('download-retry', item.url); }
            );
            actions.appendChild(retryBtn);
        }

        if (item.state === 'completed' && item.savePath) {
            const openFileBtn = createIconButton(
                'download-open-file-btn',
                'openFile',
                t('panels.downloads.openFile'),
                () => { ipcRenderer.send('open-download-file', item.savePath); }
            );
            actions.appendChild(openFileBtn);
        }

        if (item.savePath) {
            const openBtn = createIconButton(
                'download-open-btn',
                'showInFolder',
                t('panels.downloads.showInFolder'),
                () => { openDownloadPath(item.savePath); }
            );
            actions.appendChild(openBtn);
        }

        const deleteBtn = createIconButton(
            'download-delete-btn',
            'delete',
            t('delete'),
            () => {
                const nextDownloads = store.get('downloads', []);
                nextDownloads.splice(index, 1);
                store.set('downloads', nextDownloads);
                renderDownloadsPanel();
            }
        );
        actions.appendChild(deleteBtn);

        itemEl.appendChild(content);
        itemEl.appendChild(actions);
        downloadsList.appendChild(itemEl);
    });
}

// 格式化下载时间显示
function formatDownloadTime(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;
    
    // 小于1分钟
    if (diff < 60000) {
        return t('time.justNow') || '刚刚';
    }
    // 小于1小时
    if (diff < 3600000) {
        const mins = Math.floor(diff / 60000);
        return `${mins}${t('time.minutesAgo') || '分钟前'}`;
    }
    // 小于24小时
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}${t('time.hoursAgo') || '小时前'}`;
    }
    // 超过24小时显示具体日期
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

historyBtn.addEventListener('click', () => {
    showPanel(historyPanel, historyList, 'history', historySearchInput?.value || '');
    openOverlay(historyPanel);
});
bookmarksListBtn.addEventListener('click', () => {
    showPanel(bookmarksPanel, bookmarksList, 'bookmarks', bookmarksSearchInput?.value || '');
    openOverlay(bookmarksPanel);
});
downloadsBtn.addEventListener('click', () => {
    updateDownloadsFilterUI();
    renderDownloadsPanel();
    openOverlay(downloadsPanel);
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
    openOverlay(settingsPanel);
});

if (historySearchInput) {
    historySearchInput.addEventListener('input', () => {
        showPanel(
            historyPanel,
            historyList,
            'history',
            historySearchInput.value
        );
    });
}

if (bookmarksSearchInput) {
    bookmarksSearchInput.addEventListener('input', () => {
        showPanel(
            bookmarksPanel,
            bookmarksList,
            'bookmarks',
            bookmarksSearchInput.value
        );
    });
}

if (downloadsClearAllBtn) {
    downloadsClearAllBtn.addEventListener('click', () => {
        const msg = t('panels.downloads.clearAllConfirm') || 'Clear all downloads?';
        if (!confirm(msg)) return;
        store.set('downloads', []);
        renderDownloadsPanel();
    });
}

// 清空已完成下载
const downloadsClearCompletedBtn = document.getElementById('downloads-clear-completed-btn');
if (downloadsClearCompletedBtn) {
    downloadsClearCompletedBtn.addEventListener('click', () => {
        const downloads = store.get('downloads', []);
        const filtered = downloads.filter(item => item.state !== 'completed');
        if (filtered.length === downloads.length) {
            return; // 没有已完成的下载
        }
        store.set('downloads', filtered);
        renderDownloadsPanel();
    });
}

// 清空失败下载
const downloadsClearFailedBtn = document.getElementById('downloads-clear-failed-btn');
if (downloadsClearFailedBtn) {
    downloadsClearFailedBtn.addEventListener('click', () => {
        const downloads = store.get('downloads', []);
        const filtered = downloads.filter(item => {
            const state = item.state || '';
            return state !== 'failed' && state !== 'cancelled' && state !== 'interrupted';
        });
        if (filtered.length === downloads.length) {
            return; // 没有失败的下载
        }
        store.set('downloads', filtered);
        renderDownloadsPanel();
    });
}

function updateDownloadsFilterUI() {
    if (!downloadsFilters) return;
    const active = store.get('ui.downloadsFilter', 'all');
    downloadsFilters.querySelectorAll('.filter-btn').forEach((btn) => {
        const key = btn.getAttribute('data-filter') || 'all';
        btn.classList.toggle('active', key === active);
    });
}

if (downloadsFilters) {
    downloadsFilters.addEventListener('click', (e) => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        const key = btn.getAttribute('data-filter') || 'all';
        store.set('ui.downloadsFilter', key);
        updateDownloadsFilterUI();
        renderDownloadsPanel();
    });
}

if (downloadsSearchInput) {
    downloadsSearchInput.addEventListener('input', () => {
        renderDownloadsPanel();
    });
}

incognitoToggleBtn.addEventListener('click', () => {
    toggleIncognito();
});

darkModeBtn.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-mode');
    store.set('settings.darkMode', isDark);
});

if (store.get('settings.darkMode')) {
    document.body.classList.add('dark-mode');
}

// Zoom Control Logic
function updateZoomUI(level) {
    zoomLevelText.innerText = `${Math.round(level * 100)}%`;
}

zoomInBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.tagName === 'WEBVIEW') {
        wv.getZoomFactor((factor) => {
            const newFactor = factor + 0.1;
            wv.setZoomFactor(newFactor);
            updateZoomUI(newFactor);
            setZoomForUrl(wv.getURL(), newFactor);
        });
    }
});

zoomOutBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.tagName === 'WEBVIEW') {
        wv.getZoomFactor((factor) => {
            const newFactor = Math.max(0.2, factor - 0.1);
            wv.setZoomFactor(newFactor);
            updateZoomUI(newFactor);
            setZoomForUrl(wv.getURL(), newFactor);
        });
    }
});

zoomResetBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.tagName === 'WEBVIEW') {
        wv.setZoomFactor(1.0);
        updateZoomUI(1.0);
        setZoomForUrl(wv.getURL(), 1.0);
    }
});

// Download Progress Handling
ipcRenderer.on('download-progress', (event, data) => {
    const prevState = store.get('downloads', []).find(d => d.id === data.id)?.state;
    updateDownloadStore(data);
    
    // 显示下载状态变化的 toast 通知
    if (data.state === 'completed' && prevState !== 'completed') {
        showToast(
            t('toast.downloadComplete') || `下载完成: ${data.fileName}`,
            'success'
        );
    } else if (data.state === 'failed' && prevState !== 'failed') {
        showToast(
            t('toast.downloadFailed') || `下载失败: ${data.fileName}`,
            'error'
        );
    } else if (data.state === 'cancelled' && prevState !== 'cancelled') {
        showToast(
            t('toast.downloadCancelled') || `下载已取消: ${data.fileName}`,
            'warning'
        );
    }
    
    if (!downloadsPanel.classList.contains('active')) return;
    if (window.__downloadsRaf) return;
    window.__downloadsRaf = requestAnimationFrame(() => {
        window.__downloadsRaf = null;
        updateDownloadsFilterUI();
        renderDownloadsPanel();
    });
});

searchEngineSelect.addEventListener('change', () => {
    store.set('settings.searchEngine', searchEngineSelect.value);
});

startupUrlInput.addEventListener('change', () => {
    store.set('settings.startupUrl', startupUrlInput.value);
});

clearDataBtn.addEventListener('click', () => {
    if (confirm(t('panels.settings.clearDataConfirm'))) {
        store.set('history', []);
        store.set('bookmarks', []);
        alert(t('panels.settings.clearDataDone'));
    }
});

exportDataBtn.addEventListener('click', () => {
    const data = {
        bookmarks: store.get('bookmarks', []),
        history: store.get('history', []),
        settings: store.get('settings', {})
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `byteiq-browser-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

document.querySelectorAll('.close-overlay').forEach(btn => {
    btn.addEventListener('click', () => {
        closeAllOverlays();
    });
});

if (overlayBackdrop) {
    overlayBackdrop.addEventListener('click', () => {
        closeAllOverlays();
    });
}

document.addEventListener('keydown', (e) => {
    const isCmdOrCtrl = e.metaKey || e.ctrlKey;
    if (!isCmdOrCtrl) return;
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea') return;
    if (String(e.key).toLowerCase() !== 'j') return;
    e.preventDefault();
    updateDownloadsFilterUI();
    renderDownloadsPanel();
    openOverlay(downloadsPanel);
});

// URL Input Controls
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

// Navigation Controls
goBtn.addEventListener('click', () => {
    if (urlInput.value) navigateTo(urlInput.value);
});

urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && urlInput.value) {
        navigateTo(urlInput.value);
    }
});

backBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.tagName === 'WEBVIEW' && wv.canGoBack()) {
        wv.goBack();
    }
});

forwardBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.tagName === 'WEBVIEW' && wv.canGoForward()) {
        wv.goForward();
    }
});

refreshBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.tagName === 'WEBVIEW') {
        if (wv.isLoading()) {
            wv.stop();
        } else {
            wv.reload();
        }
    }
});

// Additional Controls
homeBtn.addEventListener('click', () => {
    const startupUrl = store.get('settings.startupUrl', '').trim();
    if (startupUrl) {
        navigateTo(startupUrl);
        return;
    }

    const engine = store.get('settings.searchEngine', 'bing');
    const homePages = {
        bing: 'https://www.bing.com',
        google: 'https://www.google.com',
        baidu: 'https://www.baidu.com'
    };
    navigateTo(homePages[engine] || homePages.bing);
});

// Find in Page Logic
let findRequestId = null;

function toggleFind() {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (!wv || wv.tagName !== 'WEBVIEW') return;
    
    if (findBox.style.display === 'flex') {
        wv.stopFindInPage('clearSelection');
        findBox.style.display = 'none';
    } else {
        findBox.style.display = 'flex';
        findInput.focus();
    }
}

findInput.addEventListener('input', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.tagName === 'WEBVIEW' && findInput.value) {
        findRequestId = wv.findInPage(findInput.value);
    } else if (wv) {
        wv.stopFindInPage('clearSelection');
        findResults.innerText = '0/0';
    }
});

findNext.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && findInput.value) {
        wv.findInPage(findInput.value, { forward: true, findNext: true });
    }
});

findPrev.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && findInput.value) {
        wv.findInPage(findInput.value, { forward: false, findNext: true });
    }
});

findClose.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv) wv.stopFindInPage('clearSelection');
    findBox.style.display = 'none';
});

// Context Menu Logic
window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const tabEl = e.target.closest('.tab');
    if (tabEl) {
        const tabId = tabEl.id.replace('tab-', '');
        showTabContextMenu(e.clientX, e.clientY, tabId);
        if (contextMenu) {
            contextMenu.style.display = 'none';
        }
        return;
    }

    hideContextMenus();
    const { clientX: x, clientY: y } = e;
    contextMenu.style.top = `${y}px`;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.display = 'block';
});

window.addEventListener('click', () => {
    hideContextMenus();
});

if (tabContextMenu) {
    tabContextMenu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (!action || !tabContextTargetId) return;

        if (action === 'duplicate') {
            duplicateTab(tabContextTargetId);
        }
        if (action === 'pin') {
            setTabPinned(tabContextTargetId, true);
        }
        if (action === 'unpin') {
            setTabPinned(tabContextTargetId, false);
        }
        if (action === 'close') {
            closeTab(tabContextTargetId);
        }
        if (action === 'close-others') {
            closeOtherTabs(tabContextTargetId);
        }
        if (action === 'close-right') {
            closeTabsToRight(tabContextTargetId);
        }

        tabContextTargetId = null;
        hideContextMenus();
    });
}

document.getElementById('ctx-back').addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.canGoBack()) wv.goBack();
});
document.getElementById('ctx-forward').addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.canGoForward()) wv.goForward();
});
document.getElementById('ctx-reload').addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv) wv.reload();
});
document.getElementById('ctx-copy').addEventListener('click', () => {
    const activeEl = document.activeElement;
    if (activeEl && typeof activeEl.value === 'string') {
        const selected = activeEl.value.slice(
            activeEl.selectionStart,
            activeEl.selectionEnd
        );
        clipboard.writeText(selected || activeEl.value);
        return;
    }

    const selectedText = window.getSelection().toString();
    if (selectedText) {
        clipboard.writeText(selectedText);
    }
});
document.getElementById('ctx-paste').addEventListener('click', () => {
    const activeEl = document.activeElement;
    const text = clipboard.readText();

    if (!activeEl || typeof activeEl.value !== 'string') {
        return;
    }

    const start = activeEl.selectionStart || 0;
    const end = activeEl.selectionEnd || 0;
    const value = activeEl.value;
    activeEl.value = value.slice(0, start) + text + value.slice(end);
    const cursorPos = start + text.length;
    activeEl.setSelectionRange(cursorPos, cursorPos);
    activeEl.dispatchEvent(new Event('input'));
});
document.getElementById('ctx-inspect').addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv) wv.openDevTools();
});
document.getElementById('ctx-mute').addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv) {
        const isMuted = wv.isAudioMuted();
        wv.setAudioMuted(!isMuted);
        const tabEl = document.getElementById(`tab-${activeTabId}`);
        if (tabEl) {
            tabEl.classList.toggle('muted', !isMuted);
        }
    }
});

// Global shortcuts
window.addEventListener('keydown', (e) => {
    const isCmdOrCtrl = e.ctrlKey || e.metaKey;
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    const isInputFocused = tag === 'input' || tag === 'textarea';
    
    // Escape - 关闭所有面板/菜单/查找框
    if (e.key === 'Escape') {
        closeAllPanels();
        return;
    }
    
    // Ctrl+Tab - 切换到下一个标签页
    if (isCmdOrCtrl && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        switchToNextTab();
        return;
    }
    
    // Ctrl+Shift+Tab - 切换到上一个标签页
    if (isCmdOrCtrl && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        switchToPrevTab();
        return;
    }
    
    // Ctrl+W - 关闭当前标签页
    if (isCmdOrCtrl && e.key === 'w') {
        e.preventDefault();
        closeTab(activeTabId);
        return;
    }
    
    // Ctrl+Shift+T - 恢复关闭的标签页
    if (isCmdOrCtrl && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        restoreLastTab();
        return;
    }
    
    // Ctrl+T - 新建标签页
    if (isCmdOrCtrl && e.key === 't') {
        e.preventDefault();
        createTab();
        return;
    }
    
    // Ctrl+R 或 F5 - 刷新当前页面
    if ((isCmdOrCtrl && e.key === 'r') || e.key === 'F5') {
        e.preventDefault();
        refreshCurrentPage();
        return;
    }
    
    // 以下快捷键在输入框中不触发
    if (isInputFocused) return;
    
    if (isCmdOrCtrl && e.key === 'f') {
        e.preventDefault();
        toggleFind();
    }
    if (isCmdOrCtrl && (e.key === 'l' || e.key === 'k')) {
        e.preventDefault();
        urlInput.focus();
        urlInput.select();
    }
    if (isCmdOrCtrl && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        showPanel(historyPanel, historyList, 'history', historySearchInput?.value || '');
    }
    if (isCmdOrCtrl && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        renderDownloadsPanel();
        downloadsPanel.classList.add('active');
    }
    if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        showPanel(
            bookmarksPanel,
            bookmarksList,
            'bookmarks',
            bookmarksSearchInput?.value || ''
        );
    }
    if (isCmdOrCtrl && e.key === 'p') {
        e.preventDefault();
        const wv = document.getElementById(`webview-${activeTabId}`);
        if (wv && wv.tagName === 'WEBVIEW') wv.print();
    }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const wv = document.getElementById(`webview-${activeTabId}`);
        if (!wv || wv.tagName !== 'WEBVIEW') return;
        if (e.key === 'ArrowLeft' && wv.canGoBack()) {
            e.preventDefault();
            wv.goBack();
        }
        if (e.key === 'ArrowRight' && wv.canGoForward()) {
            e.preventDefault();
            wv.goForward();
        }
    }
});

devtoolsBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.tagName === 'WEBVIEW') {
        wv.openDevTools();
    }
});

newTabBtn.addEventListener('click', () => createTab());
tabsBar.addEventListener('dblclick', (e) => {
    if (e.target === tabsBar) {
        createTab();
    }
});

// Initialize first tab
restoreSession();

