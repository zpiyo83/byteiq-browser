const fs = require('fs');
const path = require('path');

// 同步加载布局，确保在 renderer.js 执行前完成
const root = document.getElementById('app-root');
if (root) {
  const fragmentFiles = [
    'fragments/layout/chrome-shell.html',
    'fragments/layout/new-tab-template.html',
    'fragments/layout/history-and-settings-panels.html',
    'fragments/layout/secondary-panels.html'
  ];

  try {
    const html = fragmentFiles
      .map(relativePath => {
        const fullPath = path.join(__dirname, relativePath);
        return fs.readFileSync(fullPath, 'utf8').trim();
      })
      .join('');

    root.innerHTML = html;
  } catch (error) {
    console.error('[layout-loader] Failed to load layout fragments:', error);
    root.innerHTML = '<div style="padding:16px">Layout load failed.</div>';
  }
} else {
  console.error('[layout-loader] app-root not found');
}
