/**
 * AI Webview 工具桥接（安全执行DOM操作）
 */

function buildSafeScript(handlerSource, args) {
  const argsJson = JSON.stringify(args || {});
  return `(() => {\n  const args = ${argsJson};\n  ${handlerSource}\n})()`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isWebviewNotReadyError(error) {
  const message = error && error.message ? String(error.message) : '';
  return (
    message.includes('WebView must be attached to the DOM') ||
    message.includes('dom-ready event emitted') ||
    message.includes('dom-ready')
  );
}

function waitForWebviewDidStopLoading(webview, timeout = 100000) {
  if (!webview || webview.tagName !== 'WEBVIEW') {
    return Promise.reject(new Error('Invalid webview'));
  }

  if (typeof webview.isLoading === 'function' && !webview.isLoading()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Webview did-stop-loading timeout'));
    }, timeout);

    function cleanup() {
      clearTimeout(timer);
      webview.removeEventListener('did-stop-loading', onStop);
      webview.removeEventListener('did-fail-load', onStop);
    }

    function onStop() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }

    webview.addEventListener('did-stop-loading', onStop);
    webview.addEventListener('did-fail-load', onStop);
  });
}

async function waitForWebviewAfterInteraction(webview, options = {}) {
  if (!webview || webview.tagName !== 'WEBVIEW') return;

  let initialDelayMs = 5000;
  let timeout = 100000;

  if (typeof options === 'number') {
    timeout = options;
  } else {
    if (typeof options.initialDelayMs === 'number') {
      initialDelayMs = options.initialDelayMs;
    }
    if (typeof options.timeout === 'number') {
      timeout = options.timeout;
    }
  }

  // 用户要求：默认等待 5 秒，5 秒后再检查页面是否完成开启（最长 100 秒）。
  const start = Date.now();
  await sleep(initialDelayMs);

  let remaining = timeout - (Date.now() - start);
  if (remaining <= 0) {
    throw new Error('Webview after-interaction timeout');
  }

  await waitForWebviewAttached(webview, remaining);
  remaining = timeout - (Date.now() - start);
  if (remaining <= 0) {
    throw new Error('Webview after-interaction timeout');
  }

  if (typeof webview.isLoading === 'function' && webview.isLoading()) {
    if (webview.dataset) {
      webview.dataset.domReady = 'false';
    }
    await waitForWebviewDidStopLoading(webview, remaining);
  }

  remaining = timeout - (Date.now() - start);
  if (remaining <= 0) {
    throw new Error('Webview after-interaction timeout');
  }

  await ensureWebviewDomReady(webview, remaining);

  remaining = timeout - (Date.now() - start);
  if (remaining <= 0) {
    throw new Error('Webview after-interaction timeout');
  }

  if (typeof webview.isLoading === 'function' && webview.isLoading()) {
    await waitForWebviewDidStopLoading(webview, remaining);
    remaining = timeout - (Date.now() - start);
    if (remaining <= 0) {
      throw new Error('Webview after-interaction timeout');
    }
    await ensureWebviewDomReady(webview, remaining);
  }
}

function waitForWebviewAttached(webview, timeout = 100000) {
  if (!webview || webview.tagName !== 'WEBVIEW') {
    return Promise.reject(new Error('Invalid webview'));
  }
  if (webview.isConnected) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (webview.isConnected) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject(new Error('Webview attach timeout'));
      }
    }, 50);
  });
}

async function ensureWebviewDomReady(webview, timeout = 100000) {
  if (!webview || webview.tagName !== 'WEBVIEW') {
    throw new Error('Invalid webview');
  }

  await waitForWebviewAttached(webview, timeout);

  if (webview.dataset && webview.dataset.domReady === 'true') {
    return;
  }

  if (typeof webview.isLoading === 'function' && !webview.isLoading()) {
    if (webview.dataset) {
      webview.dataset.domReady = 'true';
    }
    return;
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      webview.removeEventListener('dom-ready', onReady);
      reject(new Error('Webview dom-ready timeout'));
    }, timeout);

    function onReady() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (webview.dataset) {
        webview.dataset.domReady = 'true';
      }
      webview.removeEventListener('dom-ready', onReady);
      resolve();
    }

    webview.addEventListener('dom-ready', onReady);
  });
}

async function executeJavaScriptWithRetry(webview, script, userGesture) {
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await ensureWebviewDomReady(webview);
      return await webview.executeJavaScript(script, userGesture);
    } catch (error) {
      lastError = error;
      if (!isWebviewNotReadyError(error)) {
        throw error;
      }

      if (webview && webview.dataset) {
        webview.dataset.domReady = 'false';
      }
      await sleep(150);
    }
  }

  throw lastError || new Error('Webview not ready');
}

async function clickElement(webview, { selector }) {
  try {
    const handler = `
    try {
      let el;
      try {
        el = document.querySelector(args.selector);
      } catch (error) {
        return { success: false, error: 'Invalid selector' };
      }
      if (!el) {
        return { success: false, error: 'Element not found' };
      }
      const style = window.getComputedStyle(el);
      if (style.pointerEvents === 'none') {
        return { success: false, error: 'Element not clickable' };
      }
      if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
        return { success: false, error: 'Element disabled' };
      }
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      }
      if (typeof el.focus === 'function') {
        el.focus({ preventScroll: true });
      }

      let cancelled = false;
      let clicked = false;

      if (typeof el.click === 'function') {
        el.click();
        clicked = true;
      } else {
        const mouseDown = new MouseEvent(
          'mousedown',
          { bubbles: true, cancelable: true, view: window }
        );
        const mouseUp = new MouseEvent(
          'mouseup',
          { bubbles: true, cancelable: true, view: window }
        );
        const click = new MouseEvent(
          'click',
          { bubbles: true, cancelable: true, view: window }
        );
        cancelled =
          !el.dispatchEvent(mouseDown) ||
          !el.dispatchEvent(mouseUp) ||
          !el.dispatchEvent(click);
        clicked = true;
      }

      return {
        success: clicked,
        tagName: el.tagName,
        role: el.getAttribute('role') || '',
        type: el.getAttribute('type') || '',
        cancelled
      };
    } catch (error) {
      return { success: false, error: error && error.message ? error.message : 'Click failed' };
    }
    `;

    const result = await executeJavaScriptWithRetry(
      webview,
      buildSafeScript(handler, { selector }),
      true
    );

    if (result && result.success === false) {
      return result;
    }

    try {
      await waitForWebviewAfterInteraction(webview);
    } catch (error) {
      const message = error && error.message ? String(error.message) : '';
      if (isWebviewNotReadyError(error) || message.includes('timeout')) {
        return { ...result, success: false, error: '页面尚未准备好，请稍后重试' };
      }
      return { ...result, success: false, error: message || '页面尚未准备好，请稍后重试' };
    }
    return result;
  } catch (error) {
    console.error('[ai-webview-bridge] clickElement failed:', error);
    const message = error && error.message ? String(error.message) : '';
    if (isWebviewNotReadyError(error) || message.includes('timeout')) {
      return { success: false, error: '页面尚未准备好，请稍后重试' };
    }
    return { success: false, error: message || 'Click failed' };
  }
}

async function inputText(webview, { selector, text }) {
  try {
    const handler = `
    try {
      let el;
      try {
        el = document.querySelector(args.selector);
      } catch (error) {
        return { success: false, error: 'Invalid selector' };
      }
      if (!el) {
        return { success: false, error: 'Element not found' };
      }
      el.value = args.text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    } catch (error) {
      return { success: false, error: error && error.message ? error.message : 'Input failed' };
    }
    `;

    return await executeJavaScriptWithRetry(
      webview,
      buildSafeScript(handler, { selector, text }),
      true
    );
  } catch (error) {
    console.error('[ai-webview-bridge] inputText failed:', error);
    const message = error && error.message ? String(error.message) : '';
    if (isWebviewNotReadyError(error) || message.includes('timeout')) {
      return { success: false, error: '页面尚未准备好，请稍后重试' };
    }
    return { success: false, error: message || 'Input failed' };
  }
}

module.exports = {
  clickElement,
  inputText
};
