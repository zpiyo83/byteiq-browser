/**
 * 文件对话框 IPC 处理器
 * 提供保存/打开文件对话框功能
 */

function registerDialogIpc(options) {
  const { ipcMain, dialog, fs } = options;

  // 显示保存文件对话框，将内容写入用户选择的路径
  ipcMain.handle('show-save-json', async (_event, { defaultName, content }) => {
    try {
      const result = await dialog.showSaveDialog({
        title: '导出文件',
        defaultPath: defaultName || 'export.json',
        filters: [
          { name: 'JSON 文件', extensions: ['json'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      fs.writeFileSync(result.filePath, content, 'utf-8');
      return { success: true, filePath: result.filePath };
    } catch (error) {
      return { success: false, error: error.message || '保存失败' };
    }
  });
}

module.exports = { registerDialogIpc };
