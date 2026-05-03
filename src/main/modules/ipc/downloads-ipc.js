/**
 * 下载相关 IPC 与会话处理
 */

function createDownloadsManager(options) {
  const { ipcMain, shell, getMainWindow } = options;

  let downloadSeq = 0;
  const downloadItemsById = new Map();
  // 记录中断超时计时器，恢复/完成时清除
  const interruptedTimeoutIds = new Map();

  function registerIpc() {
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
      const mainWindow = getMainWindow();
      if (!url || !mainWindow) return;
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          console.warn(
            '[downloads-ipc] Blocked retry with unsafe protocol:',
            parsedUrl.protocol,
            url
          );
          return;
        }
        mainWindow.webContents.downloadURL(url);
      } catch (error) {
        console.error('Failed to retry download:', error);
      }
    });
  }

  function attachSession(session) {
    if (!session) return;
    session.on('will-download', (event, item) => {
      const downloadId = `d_${Date.now()}_${downloadSeq++}`;
      const fileName = item.getFilename();
      const fileSize = item.getTotalBytes();

      downloadItemsById.set(downloadId, item);

      const mainWindow = getMainWindow();
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
        const ownerWindow = getMainWindow();
        if (!ownerWindow) return;

        if (state === 'interrupted') {
          ownerWindow.webContents.send('download-progress', {
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

          // 超时清理：中断 5 分钟后若仍未恢复，从 Map 中移除以防止内存泄漏
          const timeoutId = setTimeout(
            () => {
              if (downloadItemsById.has(downloadId) && downloadItemsById.get(downloadId) === item) {
                downloadItemsById.delete(downloadId);
              }
              interruptedTimeoutIds.delete(downloadId);
            },
            5 * 60 * 1000
          );
          interruptedTimeoutIds.set(downloadId, timeoutId);
        } else if (state === 'progressing') {
          // 恢复后取消超时计时器，防止误删
          const tid = interruptedTimeoutIds.get(downloadId);
          if (tid) {
            clearTimeout(tid);
            interruptedTimeoutIds.delete(downloadId);
          }
          ownerWindow.webContents.send('download-progress', {
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
      });

      item.once('done', (event, state) => {
        const ownerWindow = getMainWindow();
        if (ownerWindow) {
          if (state === 'completed') {
            ownerWindow.webContents.send('download-progress', {
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
          } else if (state === 'cancelled') {
            ownerWindow.webContents.send('download-progress', {
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
          } else {
            ownerWindow.webContents.send('download-progress', {
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

        // 清理可能残留的中断超时计时器
        const tid = interruptedTimeoutIds.get(downloadId);
        if (tid) {
          clearTimeout(tid);
          interruptedTimeoutIds.delete(downloadId);
        }
        downloadItemsById.delete(downloadId);
      });
    });
  }

  function clearDownloads() {
    downloadItemsById.clear();
  }

  return {
    registerIpc,
    attachSession,
    clearDownloads
  };
}

module.exports = {
  createDownloadsManager
};
