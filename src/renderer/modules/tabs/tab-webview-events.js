const errorMessages = {
  '-1': '无法连接到服务器',
  '-2': '服务器返回了无效响应',
  '-3': '请求被取消',
  '-4': '连接失败',
  '-5': '域名解析失败，请检查网址是否正确',
  '-6': '连接被拒绝',
  '-7': '连接超时，请检查网络连接',
  '-8': '连接已重置',
  '-9': '内容编码错误',
  '-10': '安全证书错误',
  '-11': '不安全的连接',
  '-12': '服务器要求身份验证',
  '-13': '访问被拒绝',
  '-14': '页面资源过大',
  '-15': '重定向次数过多',
  '-16': '不支持的协议',
  '-17': '上传失败',
  '-18': '下载失败',
  '-19': '网络已断开',
  '-20': '服务器不可用',
  '-21': '服务器错误',
  '-22': 'SSL握手失败',
  '-23': 'SSL证书无效',
  '-24': 'SSL证书过期',
  '-25': 'SSL证书域名不匹配',
  '-26': '文件未找到',
  '-27': '无效的URL',
  '-28': '请求被阻止',
  '-29': 'URL已重定向',
  '-30': '连接已关闭',
  '-31': '网络连接已更改',
  '-32': '页面被阻止',
  '-33': '恶意软件警告',
  '-34': '安全浏览威胁',
  '-35': '不安全的内容'
};

// Webview event handlers
function createTabWebviewEvents(options) {
  const {
    documentRef,
    ipcRenderer,
    progressBar,
    urlInput,
    findResults,
    showToast,
    applyStoredZoom,
    updateBookmarkIcon,
    onWebviewDidStopLoading,
    onWebviewUrlChanged,
    setTabLoading,
    updateTabUrl,
    setTabIcon,
    getTabById,
    saveHistory,
    getActiveTabId
  } = options;

  function setupWebviewEvents(webview, id) {
    if (webview.dataset && typeof webview.isLoading === 'function') {
      webview.dataset.domReady = webview.isLoading() ? 'false' : 'true';
    }

    webview.addEventListener('did-start-loading', () => {
      if (webview.dataset) {
        webview.dataset.domReady = 'false';
      }
      setTabLoading(id, true);
      if (id === getActiveTabId()) {
        progressBar.style.opacity = '1';
        progressBar.style.width = '30%';
        progressBar.classList.add('loading');
      }
    });

    webview.addEventListener('did-stop-loading', () => {
      setTabLoading(id, false);
      if (id === getActiveTabId()) {
        urlInput.value = webview.getURL();
        progressBar.classList.remove('loading');
        progressBar.style.width = '100%';
        setTimeout(() => {
          progressBar.style.opacity = '0';
          setTimeout(() => {
            progressBar.style.width = '0%';
          }, 200);
        }, 300);
      }
      updateTabUrl(id, webview.getURL());
      applyStoredZoom(webview);
      updateBookmarkIcon(webview.getURL());
      if (typeof onWebviewDidStopLoading === 'function') {
        onWebviewDidStopLoading(webview, id);
      }
    });

    webview.addEventListener('dom-ready', () => {
      if (webview.dataset) {
        webview.dataset.domReady = 'true';
      }
    });

    webview.addEventListener('found-in-page', e => {
      const result = e.result;
      if (result.matches !== undefined) {
        findResults.innerText = `${result.activeMatchOrdinal || 0}/${result.matches}`;
      }
    });

    webview.addEventListener('page-favicon-updated', e => {
      const icon = e.favicons && e.favicons.length > 0 ? e.favicons[0] : '';
      setTabIcon(id, icon);
    });

    webview.addEventListener('page-title-updated', e => {
      const tabEl = documentRef.getElementById(`tab-${id}`);
      if (tabEl) {
        tabEl.querySelector('.tab-title').innerText = e.title;
      }
      const tab = getTabById(id);
      if (tab) {
        tab.title = e.title;
      }
      saveHistory(webview.getURL(), e.title);
    });

    webview.addEventListener('did-navigate', e => {
      updateTabUrl(id, e.url);
      applyStoredZoom(webview);
      if (typeof onWebviewUrlChanged === 'function') {
        onWebviewUrlChanged({
          id,
          kind: 'did-navigate',
          url: e.url,
          webview
        });
      }
    });

    webview.addEventListener('did-navigate-in-page', e => {
      updateTabUrl(id, e.url);
      if (typeof onWebviewUrlChanged === 'function') {
        onWebviewUrlChanged({
          id,
          kind: 'did-navigate-in-page',
          url: e.url,
          webview
        });
      }
    });

    webview.addEventListener('did-fail-load', e => {
      if (e.errorCode === -3) return;

      console.error('Failed to load:', e);

      if (e.validatedURL && e.validatedURL.startsWith('chrome-extension://')) {
        ipcRenderer.send('extensions-log', {
          sourceId: e.validatedURL,
          level: 'error',
          message: `did-fail-load(${e.errorCode}) ${e.errorDescription || ''}`,
          detail: `url=${e.validatedURL}`
        });
      }

      const errorMsg = errorMessages[String(e.errorCode)] || e.errorDescription || '未知错误';
      showToast(`页面加载失败: ${errorMsg}`, 'error');
    });

    webview.addEventListener('console-message', e => {
      if (!e || !e.sourceId || !String(e.sourceId).startsWith('chrome-extension://')) {
        return;
      }

      ipcRenderer.send('extensions-log', {
        sourceId: e.sourceId,
        level: e.level === 2 ? 'error' : e.level === 1 ? 'warn' : 'log',
        message: e.message,
        detail: `line=${e.line || 0}`
      });
    });
  }

  return {
    setupWebviewEvents
  };
}

module.exports = {
  createTabWebviewEvents
};
