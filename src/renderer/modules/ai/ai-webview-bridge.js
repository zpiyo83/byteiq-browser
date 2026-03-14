/**
 * AI Webview 工具桥接（安全执行DOM操作）
 */

function buildSafeScript(handlerSource, args) {
  const argsJson = JSON.stringify(args || {});
  return `(() => {\n  const args = ${argsJson};\n  ${handlerSource}\n})()`;
}

async function clickElement(webview, { selector }) {
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

    return { success: clicked, tagName: el.tagName, cancelled };
  } catch (error) {
    return { success: false, error: error && error.message ? error.message : 'Click failed' };
  }
  `;

  return webview.executeJavaScript(buildSafeScript(handler, { selector }), true);
}

async function inputText(webview, { selector, text }) {
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

  return webview.executeJavaScript(buildSafeScript(handler, { selector, text }), true);
}

module.exports = {
  clickElement,
  inputText
};
