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
const {
  registerTranslationIpcHandlers
} = require('./modules/translation-ipc');
const {
  createExtensionsManager
} = require('./modules/extensions-manager');

const store = new Store();

let mainWindow;
let devtoolsView = null;
let devtoolsWebContentsId = null;

let downloadSeq = 0;
const downloadItemsById = new Map();

registerTranslationIpcHandlers({
  app,
  ipcMain
});

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

ipcMain.on('open-download-path', (event, filePath) => {
  if (filePath) {
    shell.showItemInFolder(filePath);
  }
});

ipcMain.on('open-download-file', async (event, filePath) => {
  if (!filePath) return;
  try {
    await shell.openPath(filePath);
  } catch (error) {
    console.error('Failed to open downloaded file:', error);
  }
});

ipcMain.on('download-pause', (event, downloadId) => {
  const item = downloadItemsById.get(downloadId);
  if (!item) return;
  try {
    item.pause();
  } catch (error) {
    console.error('Failed to pause download:', error);
  }
});

ipcMain.on('download-resume', (event, downloadId) => {
  const item = downloadItemsById.get(downloadId);
  if (!item) return;
  try {
    item.resume();
  } catch (error) {
    console.error('Failed to resume download:', error);
  }
});

ipcMain.on('download-cancel', (event, downloadId) => {
  const item = downloadItemsById.get(downloadId);
  if (!item) return;
  try {
    item.cancel();
  } catch (error) {
    console.error('Failed to cancel download:', error);
  }
});

ipcMain.on('download-retry', (event, url) => {
  if (!url || !mainWindow) return;
  try {
    mainWindow.webContents.downloadURL(url);
  } catch (error) {
    console.error('Failed to retry download:', error);
  }
});

function setupWebviewWindowHandler() {
  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() !== 'webview') {
      return;
    }

    contents.setWindowOpenHandler(({ url }) => {
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
          const ownerWindow = contents.getOwnerBrowserWindow();
          if (ownerWindow) {
            ownerWindow.webContents.send('open-new-tab', url);
          } else {
            contents.loadURL(url);
          }
        } else {
          shell.openExternal(url);
        }
      } catch (error) {
        console.error('Invalid popup URL:', url, error);
      }

      return { action: 'deny' };
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      webviewTag: true
    },
    title: 'Byteiq Browser',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png')
  });

  // Handle downloads
  mainWindow.webContents.session.on('will-download', (event, item) => {
    const downloadId = `d_${Date.now()}_${downloadSeq++}`;
    const fileName = item.getFilename();
    const fileSize = item.getTotalBytes();

    downloadItemsById.set(downloadId, item);

    if (mainWindow) {
      mainWindow.webContents.send('download-progress', {
        id: downloadId,
        fileName,
        received: item.getReceivedBytes(),
        total: fileSize,
        state: 'progressing',
        savePath: item.getSavePath(),
        url: item.getURL(),
        mimeType: item.getMimeType(),
        paused: item.isPaused()
      });
    }

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        console.log('Download is interrupted but can be resumed');
        if (mainWindow) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            fileName,
            received: item.getReceivedBytes(),
            total: fileSize,
            state: 'interrupted',
            savePath: item.getSavePath(),
            url: item.getURL(),
            mimeType: item.getMimeType(),
            paused: item.isPaused()
          });
        }
      } else if (state === 'progressing') {
        if (item.isPaused()) {
          console.log('Download is paused');
          if (mainWindow) {
            mainWindow.webContents.send('download-progress', {
              id: downloadId,
              fileName,
              received: item.getReceivedBytes(),
              total: fileSize,
              state: 'progressing',
              savePath: item.getSavePath(),
              url: item.getURL(),
              mimeType: item.getMimeType(),
              paused: true
            });
          }
        } else {
          console.log(`Received bytes: ${item.getReceivedBytes()}`);
          if (mainWindow) {
            mainWindow.webContents.send('download-progress', {
              id: downloadId,
              fileName,
              received: item.getReceivedBytes(),
              total: fileSize,
              state: 'progressing',
              savePath: item.getSavePath(),
              url: item.getURL(),
              mimeType: item.getMimeType(),
              paused: false
            });
          }
        }
      }
    });

    item.once('done', (event, state) => {
      if (state === 'completed') {
        console.log('Download successfully');
        if (mainWindow) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            fileName,
            state: 'completed',
            savePath: item.getSavePath(),
            url: item.getURL(),
            mimeType: item.getMimeType(),
            received: item.getReceivedBytes(),
            total: fileSize,
            paused: item.isPaused()
          });
        }
      } else if (state === 'cancelled') {
        console.log('Download cancelled');
        if (mainWindow) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            fileName,
            state: 'cancelled',
            savePath: item.getSavePath(),
            url: item.getURL(),
            mimeType: item.getMimeType(),
            received: item.getReceivedBytes(),
            total: fileSize,
            paused: item.isPaused()
          });
        }
      } else {
        console.log(`Download failed: ${state}`);
        if (mainWindow) {
          mainWindow.webContents.send('download-progress', {
            id: downloadId,
            fileName,
            state: 'failed',
            error: state,
            savePath: item.getSavePath(),
            url: item.getURL(),
            mimeType: item.getMimeType(),
            received: item.getReceivedBytes(),
            total: fileSize,
            paused: item.isPaused()
          });
        }
      }

      downloadItemsById.delete(downloadId);
    });
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    downloadItemsById.clear();
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
    const toolbarHeight = 72;

    const devtoolsHeaderHeight = 36;

    devtoolsView.setBounds({
      x: windowWidth - sidebarWidth,
      y: toolbarHeight + devtoolsHeaderHeight,
      width: sidebarWidth,
      height: windowHeight - toolbarHeight - devtoolsHeaderHeight
    });
  });
}

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
    devtoolsWebContentsId = null;
    mainWindow.webContents.send('devtools-sidebar-closed');
    return;
  }

  // 打开开发者工具
  devtoolsView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devtools: true
    }
  });

  mainWindow.addBrowserView(devtoolsView);

  const [windowWidth, windowHeight] = mainWindow.getSize();
  const sidebarWidth = width || 400;
  const toolbarHeight = 72; // tabs + toolbar
  const devtoolsHeaderHeight = 36; // 开发者工具标题栏高度

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
    devtoolsWebContentsId = webContentsId;
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

// 窗口大小改变时更新开发者工具位置
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

app.whenReady().then(() => {
  setupWebviewWindowHandler();
  createWindow();
  createMenu();
  extensionsManager.attachExtensionListeners();
  extensionsManager.loadEnabledExtensions();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
