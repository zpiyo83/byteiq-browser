/**
 * Markdown 渲染模块
 */

const { marked } = require('marked');

marked.setOptions({
  breaks: true,
  gfm: true
});

function renderMarkdown(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  try {
    return marked.parse(text);
  } catch (e) {
    console.error('Markdown render error:', e);
    return text;
  }
}

module.exports = {
  renderMarkdown
};
