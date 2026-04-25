/**
 * AI 附件工具函数
 * 负责构建附件提示词
 */

const fs = require('fs');

function buildAttachmentPrompt(files, userText) {
  const safeText = (userText || '').trim();
  const list = Array.isArray(files) ? files : [];

  const lines = [];
  lines.push('【附件】');

  for (const file of list) {
    if (!file) continue;
    const name = file.name || 'unknown';
    const filePath = file.path || '';
    const size = typeof file.size === 'number' ? file.size : 0;
    lines.push(`- ${name}${size ? ` (${Math.round(size / 1024)}KB)` : ''}`);

    const isTextLike =
      (file.type && file.type.startsWith('text/')) ||
      /\.(md|txt|json|js|ts|css|html|xml|yaml|yml|csv)$/i.test(name);

    if (filePath && isTextLike && size > 0 && size <= 200 * 1024) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const snippet = content.length > 2000 ? `${content.slice(0, 2000)}\n...` : content;
        lines.push('```');
        lines.push(snippet);
        lines.push('```');
      } catch {
        // ignore
      }
    }
  }

  if (safeText) {
    lines.push('');
    lines.push('【问题】');
    lines.push(safeText);
  }

  return lines.join('\n');
}

module.exports = {
  buildAttachmentPrompt
};
