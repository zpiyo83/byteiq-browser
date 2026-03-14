/**
 * 版本信息 IPC 处理器
 */

function registerVersionIpc(options) {
  const { ipcMain, app } = options;

  ipcMain.handle('get-version-info', () => {
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      v8Version: process.versions.v8
    };
  });
}

module.exports = {
  registerVersionIpc
};
