const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

let mainWindow;

let downloadSeq = 0;
const downloadItemsById = new Map();

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
  });
}

function createMenu() {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  setupWebviewWindowHandler();
  createWindow();
  createMenu();

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
