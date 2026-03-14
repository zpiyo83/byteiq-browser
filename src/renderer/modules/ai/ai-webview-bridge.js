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
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    }
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    const cancelled = !el.dispatchEvent(event);
    return { success: true, tagName: el.tagName, cancelled };
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
