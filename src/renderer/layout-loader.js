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

  // 需要插入到容器内的子片段（在主HTML加载后插入）
  const insertFragments = [
    {
      file: 'fragments/layout/settings-advanced-sections.html',
      into: 'settings-content',
      before: 'settings-extensions'
    }
  ];

  try {
    const html = fragmentFiles
      .map(relativePath => {
        const fullPath = path.join(__dirname, relativePath);
        return fs.readFileSync(fullPath, 'utf8').trim();
      })
      .join('');

    root.innerHTML = html;

    // 加载并插入子片段到指定容器内
    for (const frag of insertFragments) {
      try {
        const fragPath = path.join(__dirname, frag.file);
        const fragHtml = fs.readFileSync(fragPath, 'utf8').trim();
        const container = document.getElementById(frag.into);
        if (container) {
          const beforeEl = document.getElementById(frag.before);
          if (beforeEl) {
            beforeEl.insertAdjacentHTML('beforebegin', fragHtml);
          } else {
            container.insertAdjacentHTML('beforeend', fragHtml);
          }
        }
      } catch (fragError) {
        console.error(`[layout-loader] Failed to load fragment ${frag.file}:`, fragError);
      }
    }
  } catch (error) {
    console.error('[layout-loader] Failed to load layout fragments:', error);
    root.innerHTML = '<div style="padding:16px">Layout load failed.</div>';
  }
} else {
  console.error('[layout-loader] app-root not found');
}
