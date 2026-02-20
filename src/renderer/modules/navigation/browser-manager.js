// 创建浏览器管理器工厂函数
function createBrowserManager(options) {
  const {
    documentRef,
    store,
    t,
    urlInput,
    getActiveTabId,
    getIncognito,
    setIncognito,
    setupWebviewEvents,
    updateTabUrl,
    updateBookmarkIcon,
    updateZoomUI,
    modalManager
  } = options;

  // 从URL中提取主机名
  function getHostFromUrl(url) {
    try {
      return new URL(url).host;
    } catch (error) {
      return '';
    }
  }

  // 获取特定URL的缩放级别
  function getZoomForUrl(url) {
    const host = getHostFromUrl(url);
    if (!host) return null;
    const zoomByHost = store.get('zoomByHost', {});
    return zoomByHost[host] || null;
  }

  // 设置特定URL的缩放级别
  function setZoomForUrl(url, factor) {
    const host = getHostFromUrl(url);
    if (!host) return;
    const zoomByHost = store.get('zoomByHost', {});
    zoomByHost[host] = factor;
    store.set('zoomByHost', zoomByHost);
  }

  // 同步缩放UI显示
  function syncZoomUI(webview) {
    if (!webview || webview.tagName !== 'WEBVIEW') return;
    webview.getZoomFactor(factor => {
      updateZoomUI(factor);
    });
  }

  // 应用存储的缩放级别
  function applyStoredZoom(webview) {
    if (!webview || webview.tagName !== 'WEBVIEW') return;
    const storedZoom = getZoomForUrl(webview.getURL());
    if (storedZoom) {
      webview.setZoomFactor(storedZoom);
      if (webview.id === `webview-${getActiveTabId()}`) {
        updateZoomUI(storedZoom);
      }
      return;
    }
    if (webview.id === `webview-${getActiveTabId()}`) {
      syncZoomUI(webview);
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

  function navigateTo(url, id = getActiveTabId()) {
    const formattedUrl = formatUrl(url);
    const container = documentRef.getElementById(`webview-${id}`);

    if (!container) return;

    if (container.tagName !== 'WEBVIEW') {
      const webview = documentRef.createElement('webview');
      webview.id = `webview-${id}`;
      webview.src = formattedUrl;
      webview.setAttribute('allowpopups', '');

      if (getIncognito()) {
        webview.setAttribute('partition', 'incognito');
      }

      container.replaceWith(webview);
      setupWebviewEvents(webview, id);
      if (id === getActiveTabId()) {
        webview.classList.add('active');
        urlInput.value = formattedUrl;
      }
      updateTabUrl(id, formattedUrl);
    } else {
      container.src = formattedUrl;
      updateTabUrl(id, formattedUrl);
    }
  }

  function refreshCurrentPage() {
    const wv = documentRef.getElementById(`webview-${getActiveTabId()}`);
    if (wv && wv.tagName === 'WEBVIEW') {
      if (wv.isLoading()) {
        wv.stop();
      } else {
        wv.reload();
      }
    }
  }

  function toggleIncognito() {
    const nextIncognito = !getIncognito();
    setIncognito(nextIncognito);
    documentRef.body.classList.toggle('incognito-mode', nextIncognito);
    if (modalManager) {
      modalManager.alert(
        nextIncognito ? t('panels.settings.incognitoOn') : t('panels.settings.incognitoOff'),
        nextIncognito ? '隐身模式已开启' : '隐身模式已关闭'
      );
    }
  }

  function onActiveWebviewChanged(webview) {
    if (webview && webview.tagName === 'WEBVIEW') {
      const url = webview.getURL();
      urlInput.value = url;
      updateBookmarkIcon(url);
      applyStoredZoom(webview);
    } else {
      urlInput.value = '';
      updateBookmarkIcon('');
      updateZoomUI(1.0);
    }
  }

  return {
    applyStoredZoom,
    formatUrl,
    getZoomForUrl,
    navigateTo,
    onActiveWebviewChanged,
    refreshCurrentPage,
    setZoomForUrl,
    syncZoomUI,
    toggleIncognito
  };
}

module.exports = {
  createBrowserManager
};
