// Electron 主进程入口文件
const {
  app,
  BrowserWindow,
  BrowserView,
  Menu,
  dialog,
  shell,
  ipcMain,
  session
} = require('electron');
const fs = require('fs');
const path = require('path');
const Store = require('electron-store');
const { createExtensionsManager } = require('./modules/extensions-manager');
const {
  translateTexts,
  translateTextsStreaming,
  chunkTexts
} = require('./modules/translation/ai-translator');
const {
  sendStreamingChatRequest,
  sendChatRequest,
  sendResponsesStreamForAgent,
  sendChatCompletionsStreamForAgent
} = require('./modules/ai-chat');
const { fetchAiModels } = require('./modules/ai-models');
const { createDownloadsManager } = require('./modules/ipc/downloads-ipc');
const { registerTranslationIpc } = require('./modules/ipc/translation-ipc');
const { registerAiIpc } = require('./modules/ipc/ai-ipc');
const { registerVersionIpc } = require('./modules/ipc/version-ipc');
const { registerDialogIpc } = require('./modules/ipc/dialog-ipc');

// 持久化存储实例
const store = new Store();

// 全局变量
let mainWindow; // 主窗口实例
let devtoolsView = null; // 开发者工具视图

const downloadsManager = createDownloadsManager({
  ipcMain,
  shell,
  getMainWindow: () => mainWindow
});

// 创建扩展管理器实例
const extensionsManager = createExtensionsManager({
  BrowserWindow,
  dialog,
  fs,
  ipcMain,
  path,
  session,
  store,
  getMainWindow: () => mainWindow
});

downloadsManager.registerIpc();
registerTranslationIpc({
  ipcMain,
  store,
  translateTexts,
  translateTextsStreaming,
  chunkTexts
});
registerAiIpc({
  ipcMain,
  store,
  sendStreamingChatRequest,
  sendChatRequest,
  sendResponsesStreamForAgent,
  sendChatCompletionsStreamForAgent,
  fetchAiModels
});
registerVersionIpc({
  ipcMain,
  app
});
registerDialogIpc({
  ipcMain,
  dialog,
  fs
});

// 设置webview窗口处理器，处理弹窗和新窗口
function setupWebviewWindowHandler() {
  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() !== 'webview') {
      return;
    }

    // 拦截webview中的窗口打开请求
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
          const ownerWindow = contents.getOwnerBrowserWindow();
          if (ownerWindow) {
            // 在新标签页中打开
            ownerWindow.webContents.send('open-new-tab', url);
          } else {
            contents.loadURL(url).catch(error => {
              if (error && error.code === 'ERR_ABORTED') return;
              console.error('Failed to open popup URL:', url, error);
            });
          }
        } else {
          // 使用系统默认应用打开非HTTP链接
          shell.openExternal(url);
        }
      } catch (error) {
        console.error('Invalid popup URL:', url, error);
      }

      return { action: 'deny' };
    });
  });
}

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true, // 启用Node.js集成
      contextIsolation: false, // 禁用上下文隔离
      webSecurity: true, // 启用Web安全
      webviewTag: true // 启用webview标签
    },
    title: 'Byteiq Browser',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png')
  });

  downloadsManager.attachSession(mainWindow.webContents.session);

  // 加载HTML文件
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 开发模式下打开开发者工具
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    downloadsManager.clearDownloads();
    // 关闭开发者工具视图
    if (devtoolsView) {
      devtoolsView.webContents.destroy();
      devtoolsView = null;
    }
  });

  // 窗口大小改变时更新开发者工具位置
  mainWindow.on('resize', () => {
    if (!devtoolsView) return;

    const [windowWidth, windowHeight] = mainWindow.getSize();
    const sidebarWidth = devtoolsView.getBounds().width;
    const toolbarHeight = 72; // 工具栏高度
    const devtoolsHeaderHeight = 36; // 开发者工具标题栏高度

    devtoolsView.setBounds({
      x: windowWidth - sidebarWidth,
      y: toolbarHeight + devtoolsHeaderHeight,
      width: sidebarWidth,
      height: windowHeight - toolbarHeight - devtoolsHeaderHeight
    });
  });
}

// 创建应用菜单（隐藏菜单栏）
function createMenu() {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null);
}

// 开发者工具侧边栏管理
ipcMain.on('toggle-devtools-sidebar', (event, { webContentsId, width }) => {
  if (!mainWindow) return;

  if (devtoolsView) {
    // 关闭开发者工具
    mainWindow.removeBrowserView(devtoolsView);
    devtoolsView.webContents.destroy();
    devtoolsView = null;
    mainWindow.webContents.send('devtools-sidebar-closed');
    return;
  }

  // 打开开发者工具
  devtoolsView = new BrowserView({
    webPreferences: {
      nodeIntegration: false, // 禁用Node.js集成以提高安全性
      contextIsolation: true, // 启用上下文隔离
      devtools: true // 启用开发者工具
    }
  });

  mainWindow.addBrowserView(devtoolsView);

  const [windowWidth, windowHeight] = mainWindow.getSize();
  const sidebarWidth = width || 400;
  const toolbarHeight = 72; // 标签栏 + 工具栏高度
  const devtoolsHeaderHeight = 36; // 开发者工具标题栏高度

  // 设置开发者工具视图的位置和大小
  devtoolsView.setBounds({
    x: windowWidth - sidebarWidth,
    y: toolbarHeight + devtoolsHeaderHeight,
    width: sidebarWidth,
    height: windowHeight - toolbarHeight - devtoolsHeaderHeight
  });

  devtoolsView.setAutoResize({ width: false, height: true });

  // 获取目标webview的webContents
  const webContents = webContentsId ? require('electron').webContents.fromId(webContentsId) : null;

  if (webContents) {
    webContents.setDevToolsWebContents(devtoolsView.webContents);
    webContents.openDevTools();
  }

  mainWindow.webContents.send('devtools-sidebar-opened', { width: sidebarWidth });
});

// 更新开发者工具侧边栏宽度
ipcMain.on('resize-devtools-sidebar', (event, { width }) => {
  if (!mainWindow || !devtoolsView) return;

  const [windowWidth, windowHeight] = mainWindow.getSize();
  const toolbarHeight = 72;
  const devtoolsHeaderHeight = 36;

  devtoolsView.setBounds({
    x: windowWidth - width,
    y: toolbarHeight + devtoolsHeaderHeight,
    width: width,
    height: windowHeight - toolbarHeight - devtoolsHeaderHeight
  });
});

// 窗口大小改变时更新开发者工具位置（通过IPC调用）
ipcMain.on('window-resized', (event, { width, height }) => {
  if (!mainWindow || !devtoolsView) return;

  const sidebarWidth = devtoolsView.getBounds().width;
  const toolbarHeight = 72;
  const devtoolsHeaderHeight = 36;

  devtoolsView.setBounds({
    x: width - sidebarWidth,
    y: toolbarHeight + devtoolsHeaderHeight,
    width: sidebarWidth,
    height: height - toolbarHeight - devtoolsHeaderHeight
  });
});

// 应用启动完成后的初始化
app.whenReady().then(() => {
  setupWebviewWindowHandler();
  createWindow();
  createMenu();

  // 初始化扩展管理器
  extensionsManager.attachExtensionListeners();
  extensionsManager.loadEnabledExtensions();

  // macOS 特有处理：当点击dock图标时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭时的处理（macOS除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
