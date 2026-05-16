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

  try {
    if (typeof webview.isLoading === 'function' && !webview.isLoading()) {
      return Promise.resolve();
    }
  } catch {
    // webview 尚未 dom-ready，isLoading 不可用，等待事件
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

  try {
    if (typeof webview.isLoading === 'function' && webview.isLoading()) {
      if (webview.dataset) {
        webview.dataset.domReady = 'false';
      }
      await waitForWebviewDidStopLoading(webview, remaining);
    }
  } catch {
    // webview 尚未 dom-ready，等待事件
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

  let stillLoading = false;
  try {
    stillLoading = typeof webview.isLoading === 'function' && webview.isLoading();
  } catch {
    // webview 尚未 dom-ready
  }
  if (stillLoading) {
    await waitForWebviewDidStopLoading(webview, remaining);
    remaining = timeout - (Date.now() - start);
    if (remaining <= 0) {
      throw new Error('Webview after-interaction timeout');
    }
    await ensureWebviewDomReady(webview, remaining);
  }
}

function waitForWebviewAttached(webview, timeout = 10000) {
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

async function ensureWebviewDomReady(webview, timeout = 10000) {
  if (!webview || webview.tagName !== 'WEBVIEW') {
    throw new Error('Invalid webview');
  }

  // 只确保 webview 挂载到 DOM，不再预测 dom-ready
  // 真正的就绪检测交给 executeJavaScriptWithRetry 的重试机制
  await waitForWebviewAttached(webview, timeout);
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
      const message = error && error.message ? String(error.message) : '';
      console.warn(`[ai-webview-bridge] executeJavaScript attempt ${attempt + 1} failed:`, message);

      if (isWebviewNotReadyError(error) || message.includes('attached to the DOM')) {
        if (webview && webview.dataset) {
          webview.dataset.domReady = 'false';
        }
        // 对于刚创建的 WebView，给一点喘息时间让它在渲染进程中真正挂载
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw error;
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

      // 增强 actionability 检查（参考 Playwright）
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return { success: false, error: 'Element not visible' };
      }
      if (parseFloat(style.opacity) === 0) {
        return { success: false, error: 'Element not visible (opacity: 0)' };
      }
      if (style.pointerEvents === 'none') {
        return { success: false, error: 'Element not clickable (pointer-events: none)' };
      }
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
        return { success: false, error: 'Element disabled' };
      }

      // 稳定性检查：确保元素不在动画中（参考 Playwright 的 stable check）
      function waitForStable(maxWait) {
        return new Promise(function(resolve) {
          var start = Date.now();
          var lastRect = null;
          var stableCount = 0;
          function check() {
            var rect = el.getBoundingClientRect();
            if (lastRect &&
                Math.abs(rect.top - lastRect.top) < 1 &&
                Math.abs(rect.left - lastRect.left) < 1 &&
                Math.abs(rect.width - lastRect.width) < 1 &&
                Math.abs(rect.height - lastRect.height) < 1) {
              stableCount++;
              if (stableCount >= 2) { resolve(true); return; }
            } else {
              stableCount = 0;
            }
            lastRect = rect;
            if (Date.now() - start > maxWait) { resolve(false); return; }
            requestAnimationFrame(check);
          }
          requestAnimationFrame(check);
        });
      }

      // 等待元素稳定（最多 1.5 秒）
      var stable = false;
      try { stable = waitForStable(1500); } catch(e) { stable = true; }

      // 滚动对齐循环（参考 Playwright：依次尝试 center → start → end，处理 sticky 遮挡）
      var scrollAlignments = [
        { block: 'center', inline: 'center' },
        { block: 'start', inline: 'start' },
        { block: 'end', inline: 'end' }
      ];

      function isInViewport(rect) {
        return rect.top < window.innerHeight && rect.bottom > 0 &&
               rect.left < window.innerWidth && rect.right > 0;
      }

      function hitTest(rect) {
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var hit = document.elementFromPoint(cx, cy);
        if (!hit) return false;
        return hit === el || el.contains(hit) || hit.contains(el);
      }

      var rect = el.getBoundingClientRect();
      var scrollIndex = 0;

      // 滚动 + 命中测试循环
      if (!isInViewport(rect) || !hitTest(rect)) {
        for (scrollIndex = 0; scrollIndex < scrollAlignments.length; scrollIndex++) {
          el.scrollIntoView(scrollAlignments[scrollIndex]);
          // 等一帧让滚动生效
          var scrolled = new Promise(function(r) { requestAnimationFrame(function() { requestAnimationFrame(r); }); });
          try { scrolled; } catch(e) {}
          rect = el.getBoundingClientRect();
          if (isInViewport(rect) && hitTest(rect)) break;
        }
      }

      // 最终命中验证
      rect = el.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;

      if (typeof el.focus === 'function') {
        el.focus({ preventScroll: true });
      }

      // 拦截 target="_blank" 链接，改为当前页面导航
      var anchor = el.closest('a') || (el.tagName === 'A' ? el : null);
      if (anchor && anchor.href) {
        var targetAttr = anchor.getAttribute('target') || '';
        if (targetAttr === '_blank' || targetAttr === 'blank') {
          anchor.removeAttribute('target');
        }
      }

      // 临时覆盖 window.open，防止 JS 调用 window.open() 在新标签页打开
      var originalWindowOpen = window.open;
      window.open = function(url) {
        if (url) {
          window.location.href = url;
        }
        return null;
      };

      var cancelled = false;
      var clicked = false;

      // 派发真实鼠标事件序列（参考 Playwright 的 mousedown → mouseup → click 流程）
      var mouseOpts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: cx,
        clientY: cy,
        screenX: cx + (window.screenX || 0),
        screenY: cy + (window.screenY || 0),
        button: 0,
        buttons: 1
      };

      var mouseDown = new MouseEvent('mousedown', mouseOpts);
      var mouseUp = new MouseEvent('mouseup', mouseOpts);
      var clickEvent = new MouseEvent('click', mouseOpts);

      cancelled =
        !el.dispatchEvent(mouseDown) ||
        !el.dispatchEvent(mouseUp) ||
        !el.dispatchEvent(clickEvent);
      clicked = true;

      // 恢复 window.open
      window.open = originalWindowOpen;

      return {
        success: clicked,
        tagName: el.tagName,
        role: el.getAttribute('role') || '',
        type: el.getAttribute('type') || '',
        cancelled,
        urlBeforeClick: window.location.href,
        hitVerified: hitTest(rect)
      };
    } catch (error) {
      // 恢复 window.open（异常路径）
      if (typeof originalWindowOpen === 'function') {
        window.open = originalWindowOpen;
      }
      return { success: false, error: error && error.message ? error.message : 'Click failed' };
    }
    `;

    // 记录点击前的 URL，用于检测导航
    const urlBeforeClick = typeof webview.getURL === 'function' ? webview.getURL() : '';

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

    // 检测点击是否触发了页面导航
    let urlAfterClick = '';
    try {
      urlAfterClick = typeof webview.getURL === 'function' ? webview.getURL() : '';
    } catch {
      // webview 尚未 dom-ready
    }
    const navigated = urlBeforeClick !== urlAfterClick;
    if (navigated) {
      // 导航发生后，等待新页面完全加载
      try {
        if (webview.dataset) {
          webview.dataset.domReady = 'false';
        }
        if (typeof webview.isLoading === 'function' && webview.isLoading()) {
          await waitForWebviewDidStopLoading(webview, 15000);
        }
        await ensureWebviewDomReady(webview, 15000);
      } catch (navError) {
        console.warn('[ai-webview-bridge] Navigation wait failed after click:', navError);
      }
    }

    return { ...result, navigated };
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

      var text = args.text;

      // contenteditable 元素（参考 Playwright 对 contenteditable 的处理）
      if (el.isContentEditable || el.getAttribute('contenteditable') === '' || el.getAttribute('contenteditable') === 'true') {
        el.focus();
        // 选中所有已有内容
        var sel = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        // 使用 execCommand 插入文本，兼容富文本编辑器
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, method: 'contenteditable' };
      }

      // 特殊 input 类型：直接设置 value（参考 Playwright 对 color/date/range 等的处理）
      var tag = el.tagName.toLowerCase();
      var type = (el.getAttribute('type') || '').toLowerCase();
      var specialTypes = ['color', 'date', 'time', 'datetime-local', 'month', 'range', 'week'];
      if (tag === 'input' && specialTypes.indexOf(type) !== -1) {
        el.focus();
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return { success: true, method: 'special-type', type: type };
      }

      // 标准 input / textarea：兼容 React 受控组件
      // Playwright 的核心策略：先 selectAll 清空，再通过键盘事件输入
      // 我们简化为：使用原生 setter 绕过 React 拦截器
      el.focus();

      // 选中已有内容
      if (typeof el.select === 'function') {
        el.select();
      }

      // 使用原生 value setter 绕过 React 的 value 拦截器
      // React 会用自己的 setter 覆盖 el.value 的赋值行为
      // 通过原型链上的原生 setter 可以绕过这个限制
      var nativeSetter = null;
      if (tag === 'input') {
        nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        );
      } else if (tag === 'textarea') {
        nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        );
      }

      if (nativeSetter && nativeSetter.set) {
        nativeSetter.set.call(el, text);
      } else {
        el.value = text;
      }

      // 完整事件序列（参考 Playwright 的 fill 流程）
      el.dispatchEvent(new Event('focus', { bubbles: true }));
      el.dispatchEvent(new Event('select', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));

      return { success: true, method: 'native-setter' };
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
