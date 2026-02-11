const { ipcRenderer } = require('electron');
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

let tabs = [];
let activeTabId = null;

// Initialize i18n
initI18n();

// Language selection
const langSelect = document.getElementById('lang-select');
if (langSelect) {
    langSelect.value = store.get('settings.language', 'zh-CN');
    langSelect.addEventListener('change', () => {
        setLocale(langSelect.value);
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
        
        if (text.includes('总结') || text.includes('summary')) {
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

function createTab(url = null) {
    const startupUrl = store.get('settings.startupUrl', '');
    const targetUrl = url || startupUrl || null;
    
    const id = Date.now().toString();
    const tab = {
        id,
        url: url,
        title: '新标签页'
    };

    tabs.push(tab);

    // Create Tab Element
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.id = `tab-${id}`;
    tabEl.innerHTML = `
        <span class="tab-title">${tab.title}</span>
        <span class="close-tab">×</span>
    `;
    tabEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('close-tab')) {
            closeTab(id);
        } else {
            switchTab(id);
        }
    });
    tabsBar.insertBefore(tabEl, newTabBtn);

    // Create Webview or New Tab Page
    if (targetUrl) {
        const webview = document.createElement('webview');
        webview.id = `webview-${id}`;
        webview.src = formatUrl(targetUrl);
        webview.setAttribute('allowpopups', '');
        
        if (isIncognito) {
            webview.setAttribute('partition', 'incognito');
        }
        
        webviewsContainer.appendChild(webview);
        setupWebviewEvents(webview, id);
    } else {
        // New Tab Page Content
        const content = newTabTemplate.content.cloneNode(true);
        const container = document.createElement('div');
        container.className = 'webview-mock active';
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
    }

    switchTab(id);
}

function setupWebviewEvents(webview, id) {
    webview.addEventListener('did-start-loading', () => {
        if (id === activeTabId) {
            refreshBtn.innerText = '✕';
            progressBar.style.opacity = '1';
            progressBar.style.width = '30%';
        }
    });

    webview.addEventListener('did-stop-loading', () => {
        if (id === activeTabId) {
            refreshBtn.innerText = '↻';
            urlInput.value = webview.getURL();
            progressBar.style.width = '100%';
            setTimeout(() => {
                progressBar.style.opacity = '0';
                setTimeout(() => progressBar.style.width = '0%', 200);
            }, 300);
        }
        updateBookmarkIcon(webview.getURL());
    });

    webview.addEventListener('found-in-page', (e) => {
        const result = e.result;
        if (result.matches !== undefined) {
            findResults.innerText = `${result.activeMatchOrdinal || 0}/${result.matches}`;
        }
    });

    webview.addEventListener('page-title-updated', (e) => {
        const tabEl = document.getElementById(`tab-${id}`);
        if (tabEl) {
            tabEl.querySelector('.tab-title').innerText = e.title;
        }
        saveHistory(webview.getURL(), e.title);
    });

    webview.addEventListener('did-fail-load', (e) => {
        if (e.errorCode !== -3) {
            console.error('Failed to load:', e);
        }
    });

    webview.addEventListener('new-window', (e) => {
        createTab(e.url);
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

    document.querySelectorAll('#webviews-container > *').forEach(w => w.style.display = 'none');
    const activeWebview = document.getElementById(`webview-${id}`);
    if (activeWebview) {
        activeWebview.style.display = 'block';
        
        if (activeWebview.tagName === 'WEBVIEW') {
            const url = activeWebview.getURL();
            urlInput.value = url;
            updateBookmarkIcon(url);
        } else {
            urlInput.value = '';
            updateBookmarkIcon('');
        }
    }
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
}

function restoreLastTab() {
    if (lastClosedTabs.length > 0) {
        const last = lastClosedTabs.pop();
        createTab(last.url);
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
            webview.style.display = 'block';
            urlInput.value = formattedUrl;
        }
    } else {
        container.src = formattedUrl;
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
function showPanel(panel, listContainer, dataKey) {
    const data = store.get(dataKey, []);
    const emptyKey = dataKey === 'history' ? 'panels.history.empty' : dataKey === 'bookmarks' ? 'panels.bookmarks.empty' : 'panels.downloads.empty';
    listContainer.innerHTML = data.length === 0 ? `<p style="text-align:center;color:#999;padding:20px;">${t(emptyKey)}</p>` : '';
    
    data.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'list-item';
        itemEl.innerHTML = `
            <a href="#" onclick="createTab('${item.url}'); return false;">
                <strong>${item.title || t('bookmark.empty')}</strong><br>
                <small style="color:#999">${item.url}</small>
            </a>
            <span class="delete-btn" data-index="${index}">${t('delete')}</span>
        `;
        itemEl.querySelector('.delete-btn').addEventListener('click', (e) => {
            const idx = e.target.dataset.index;
            data.splice(idx, 1);
            store.set(dataKey, data);
            showPanel(panel, listContainer, dataKey);
        });
        listContainer.appendChild(itemEl);
    });
    
    panel.classList.add('active');
}

historyBtn.addEventListener('click', () => showPanel(historyPanel, historyList, 'history'));
bookmarksListBtn.addEventListener('click', () => showPanel(bookmarksPanel, bookmarksList, 'bookmarks'));
downloadsBtn.addEventListener('click', () => {
    downloadsPanel.classList.add('active');
});
settingsBtn.addEventListener('click', () => {
    searchEngineSelect.value = store.get('settings.searchEngine', 'bing');
    startupUrlInput.value = store.get('settings.startupUrl', '');
    settingsPanel.classList.add('active');
});

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
        });
    }
});

zoomResetBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.tagName === 'WEBVIEW') {
        wv.setZoomFactor(1.0);
        updateZoomUI(1.0);
    }
});

// Download Progress Handling
ipcRenderer.on('download-progress', (event, data) => {
    let item = document.getElementById(`download-${data.fileName}`);
    if (!item) {
        item = document.createElement('div');
        item.id = `download-${data.fileName}`;
        item.className = 'list-item';
        downloadsList.appendChild(item);
    }

    if (data.state === 'progressing') {
        const percent = Math.round((data.received / data.total) * 100);
        item.innerHTML = `
            <div style="flex:1">
                <strong>${data.fileName}</strong><br>
                <progress value="${percent}" max="100" style="width:100%"></progress>
                <small>${percent}% (${(data.received/1024/1024).toFixed(2)}MB / ${(data.total/1024/1024).toFixed(2)}MB)</small>
            </div>
        `;
    } else if (data.state === 'completed') {
        item.innerHTML = `<strong>${data.fileName}</strong> <span style="color:green">${t('download.completed')}</span>`;
    } else if (data.state === 'failed') {
        item.innerHTML = `<strong>${data.fileName}</strong> <span style="color:red">${t('download.failed')} ${data.error}</span>`;
    }
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
        document.querySelectorAll('.overlay-panel').forEach(p => p.classList.remove('active'));
    });
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
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.tagName === 'WEBVIEW') {
        wv.src = 'about:blank';
    } else {
        createTab();
    }
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
    const { clientX: x, clientY: y } = e;
    contextMenu.style.top = `${y}px`;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.display = 'block';
});

window.addEventListener('click', () => {
    contextMenu.style.display = 'none';
});

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
    document.execCommand('copy');
});
document.getElementById('ctx-paste').addEventListener('click', () => {
    document.execCommand('paste');
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
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        toggleFind();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
        e.preventDefault();
        restoreLastTab();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        createTab();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        closeTab(activeTabId);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        const wv = document.getElementById(`webview-${activeTabId}`);
        if (wv && wv.tagName === 'WEBVIEW') wv.print();
    }
});

devtoolsBtn.addEventListener('click', () => {
    const wv = document.getElementById(`webview-${activeTabId}`);
    if (wv && wv.tagName === 'WEBVIEW') {
        wv.openDevTools();
    }
});

newTabBtn.addEventListener('click', () => createTab());

// Initialize first tab
createTab();
