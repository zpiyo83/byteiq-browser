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
const { sendStreamingChatRequest } = require('./modules/ai-chat');

// 持久化存储实例
const store = new Store();

// 全局变量
let mainWindow; // 主窗口实例
let devtoolsView = null; // 开发者工具视图

// 下载管理相关变量
let downloadSeq = 0; // 下载序列号
const downloadItemsById = new Map(); // 下载项映射表

// 翻译任务取消控制
const activeTranslationRequests = new Map(); // taskId -> ClientRequest

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

// 下载相关的IPC事件处理器
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

// 翻译相关 IPC 处理器
ipcMain.handle('translate-text', async (event, { texts, targetLanguage, taskId }) => {
  const resolvedTaskId = taskId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    // 优先使用翻译专用API配置，如果未启用则使用AI设置
    const translationApiEnabled = store.get('settings.translationApiEnabled', false);
    let endpoint, apiKey, requestType, model;

    if (translationApiEnabled) {
      endpoint = store.get('settings.translationEndpoint', '');
      apiKey = store.get('settings.translationApiKey', '');
      requestType = store.get('settings.translationRequestType', 'openai-chat');
      model = store.get('settings.translationModelId', 'gpt-3.5-turbo');
    } else {
      // 回退到AI设置
      endpoint = store.get('settings.aiEndpoint', '');
      apiKey = store.get('settings.aiApiKey', '');
      requestType = store.get('settings.aiRequestType', 'openai-chat');
      model = store.get('settings.aiModelId', 'gpt-3.5-turbo');
    }

    if (!endpoint || !apiKey) {
      return {
        success: false,
        error: '请先在设置中配置翻译 API 或 AI API 端点和密钥'
      };
    }

    // 读取用户自定义的高级配置
    const maxTextsPerRequest = store.get('settings.translationMaxTexts', 500);
    const maxCharsPerRequest = store.get('settings.translationMaxChars', 50000);
    const requestTimeout = store.get('settings.translationTimeout', 120);
    const streamingEnabled = store.get('settings.translationStreaming', true);
    const concurrencyEnabled = store.get('settings.translationConcurrencyEnabled', false);
    const concurrency = Math.max(1, Math.min(10, store.get('settings.translationConcurrency', 2)));

    const results = new Array(texts.length);

    function registerRequestForTask(req) {
      const existing = activeTranslationRequests.get(resolvedTaskId);
      if (existing && typeof existing.add === 'function') {
        existing.add(req);
        return;
      }
      const set = new Set();
      set.add(req);
      activeTranslationRequests.set(resolvedTaskId, set);
    }

    function buildConcurrentGroups(allTexts, offset, limitTexts, limitChars, groupCount) {
      const remainingTexts = Math.max(0, allTexts.length - offset);
      const roundTextLimit = Math.min(limitTexts, remainingTexts);
      const actualGroups = Math.max(1, Math.min(groupCount, roundTextLimit));

      const base = Math.floor(roundTextLimit / actualGroups);
      const extra = roundTextLimit % actualGroups;
      const desiredCounts = Array.from({ length: actualGroups }, (_v, idx) => {
        return base + (idx < extra ? 1 : 0);
      });

      const groups = desiredCounts.map(() => {
        return {
          texts: [],
          startIndex: -1,
          chars: 0
        };
      });

      let globalIndex = offset;
      let takenChars = 0;

      for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        if (globalIndex >= allTexts.length) break;
        group.startIndex = globalIndex;

        while (globalIndex < allTexts.length) {
          if (group.texts.length >= desiredCounts[g]) break;
          if (group.texts.length >= maxTextsPerRequest) break;
          if (group.chars >= maxCharsPerRequest) break;
          if (takenChars >= limitChars) break;

          const nextText = allTexts[globalIndex];
          const nextLen = nextText.length;

          if (group.texts.length > 0 && group.chars + nextLen > maxCharsPerRequest) {
            break;
          }
          if (takenChars > 0 && takenChars + nextLen > limitChars) {
            break;
          }

          group.texts.push(nextText);
          group.chars += nextLen;
          takenChars += nextLen;
          globalIndex++;
        }
      }

      const nonEmptyGroups = groups.filter(group => group.texts.length > 0);
      return {
        groups: nonEmptyGroups,
        nextIndex: globalIndex
      };
    }

    if (!concurrencyEnabled || concurrency <= 1) {
      // 分块处理，使用用户配置
      const chunks = chunkTexts(texts, {
        maxTexts: maxTextsPerRequest,
        maxChars: maxCharsPerRequest
      });

      // 逐块翻译
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // 发送进度
        event.sender.send('translation-progress', {
          taskId: resolvedTaskId,
          current: i + 1,
          total: chunks.length,
          status: 'translating'
        });

        if (streamingEnabled) {
          // 流式翻译
          const translated = await translateTextsStreaming(
            chunk.texts,
            targetLanguage,
            {
              endpoint,
              apiKey,
              requestType,
              model,
              timeout: requestTimeout * 1000,
              registerRequest: req => {
                registerRequestForTask(req);
              }
            },
            (newTexts, allTexts, newTextsStartIndex) => {
              // 发送流式更新事件
              event.sender.send('translation-streaming', {
                taskId: resolvedTaskId,
                chunkIndex: i,
                startIndex: chunk.startIndex,
                newTexts: newTexts,
                allTexts: allTexts,
                newTextsStartIndex
              });
            }
          );

          // 将结果放入正确位置
          translated.forEach((text, idx) => {
            results[chunk.startIndex + idx] = text;
          });
        } else {
          // 非流式翻译
          const translated = await translateTexts(chunk.texts, targetLanguage, {
            endpoint,
            apiKey,
            requestType,
            model,
            timeout: requestTimeout * 1000
          });

          // 将结果放入正确位置
          translated.forEach((text, idx) => {
            results[chunk.startIndex + idx] = text;
          });
        }
      }
    } else {
      const perRoundMaxTexts = concurrency * maxTextsPerRequest;
      const perRoundMaxChars = concurrency * maxCharsPerRequest;
      const estimatedTotalRounds = Math.max(1, Math.ceil(texts.length / perRoundMaxTexts));

      let roundIndex = 0;
      let cursor = 0;

      while (cursor < texts.length) {
        const { groups, nextIndex } = buildConcurrentGroups(
          texts,
          cursor,
          perRoundMaxTexts,
          perRoundMaxChars,
          concurrency
        );

        if (groups.length === 0) {
          break;
        }

        roundIndex++;
        event.sender.send('translation-progress', {
          taskId: resolvedTaskId,
          current: roundIndex,
          total: estimatedTotalRounds,
          status: 'translating'
        });

        if (streamingEnabled) {
          const translatedGroups = await Promise.all(
            groups.map((group, groupIndex) => {
              return translateTextsStreaming(
                group.texts,
                targetLanguage,
                {
                  endpoint,
                  apiKey,
                  requestType,
                  model,
                  timeout: requestTimeout * 1000,
                  registerRequest: req => {
                    registerRequestForTask(req);
                  }
                },
                (newTexts, allTexts, newTextsStartIndex) => {
                  event.sender.send('translation-streaming', {
                    taskId: resolvedTaskId,
                    chunkIndex: (roundIndex - 1) * concurrency + groupIndex,
                    startIndex: group.startIndex,
                    newTexts: newTexts,
                    allTexts: allTexts,
                    newTextsStartIndex
                  });
                }
              );
            })
          );

          translatedGroups.forEach((translated, idx) => {
            const group = groups[idx];
            translated.forEach((text, localIndex) => {
              results[group.startIndex + localIndex] = text;
            });
          });
        } else {
          const translatedGroups = await Promise.all(
            groups.map(group => {
              return translateTexts(group.texts, targetLanguage, {
                endpoint,
                apiKey,
                requestType,
                model,
                timeout: requestTimeout * 1000
              });
            })
          );

          translatedGroups.forEach((translated, idx) => {
            const group = groups[idx];
            translated.forEach((text, localIndex) => {
              results[group.startIndex + localIndex] = text;
            });
          });
        }

        cursor = nextIndex;
      }
    }

    event.sender.send('translation-progress', {
      taskId: resolvedTaskId,
      status: 'completed'
    });

    activeTranslationRequests.delete(resolvedTaskId);

    return {
      success: true,
      translations: results,
      taskId: resolvedTaskId
    };
  } catch (error) {
    if (error && error.message === 'Cancelled') {
      event.sender.send('translation-progress', {
        taskId: resolvedTaskId,
        status: 'cancelled'
      });
      activeTranslationRequests.delete(resolvedTaskId);
      return {
        success: false,
        cancelled: true,
        taskId: resolvedTaskId
      };
    }

    console.error('Translation error:', error);
    activeTranslationRequests.delete(resolvedTaskId);
    return {
      success: false,
      error: error.message || '翻译失败'
    };
  }
});

ipcMain.on('cancel-translation', (_event, { taskId }) => {
  if (!taskId) return;
  const req = activeTranslationRequests.get(taskId);
  if (!req) return;
  activeTranslationRequests.delete(taskId);
  try {
    if (req && typeof req.destroy === 'function') {
      req.destroy(new Error('Cancelled'));
      return;
    }

    if (req && typeof req.forEach === 'function') {
      req.forEach(r => {
        try {
          if (r && typeof r.destroy === 'function') {
            r.destroy(new Error('Cancelled'));
          }
        } catch (error) {
          console.error('Cancel translation failed:', error);
        }
      });
    }
  } catch (error) {
    console.error('Cancel translation failed:', error);
  }
});

// 动态翻译处理器 - 用于翻译动态检测到的新文本
ipcMain.handle('translate-single-text', async (event, { texts, targetLanguage }) => {
  try {
    // 优先使用翻译专用API配置
    const translationApiEnabled = store.get('settings.translationApiEnabled', false);
    let endpoint, apiKey, requestType, model;

    if (translationApiEnabled) {
      endpoint = store.get('settings.translationEndpoint', '');
      apiKey = store.get('settings.translationApiKey', '');
      requestType = store.get('settings.translationRequestType', 'openai-chat');
      model = store.get('settings.translationModelId', 'gpt-3.5-turbo');
    } else {
      // 回退到AI设置
      endpoint = store.get('settings.aiEndpoint', '');
      apiKey = store.get('settings.aiApiKey', '');
      requestType = store.get('settings.aiRequestType', 'openai-chat');
      model = store.get('settings.aiModelId', 'gpt-3.5-turbo');
    }

    if (!endpoint || !apiKey) {
      return {
        success: false,
        error: '请先在设置中配置翻译 API 或 AI API 端点和密钥'
      };
    }

    // 读取用户配置
    const requestTimeout = store.get('settings.translationTimeout', 120);

    // 直接翻译，不分块（动态翻译通常是小批量）
    const translations = await translateTexts(texts, targetLanguage, {
      endpoint,
      apiKey,
      requestType,
      model,
      timeout: requestTimeout * 1000
    });

    return {
      success: true,
      translations: translations
    };
  } catch (error) {
    console.error('Dynamic translation error:', error);
    return {
      success: false,
      error: error.message || '翻译失败'
    };
  }
});

// AI对话任务取消控制
const activeChatRequests = new Map(); // taskId -> ClientRequest

// 获取版本信息
ipcMain.handle('get-version-info', () => {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    v8Version: process.versions.v8
  };
});

// AI 对话 IPC 处理器
ipcMain.handle('ai-chat', async (event, { messages, taskId }) => {
  const resolvedTaskId = taskId || `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    // 使用AI设置
    const endpoint = store.get('settings.aiEndpoint', '');
    const apiKey = store.get('settings.aiApiKey', '');
    const requestType = store.get('settings.aiRequestType', 'openai-chat');
    const model = store.get('settings.aiModelId', 'gpt-3.5-turbo');
    const timeout = (store.get('settings.translationTimeout', 120) || 120) * 1000;

    if (!endpoint || !apiKey) {
      return {
        success: false,
        error: '请先在设置中配置 AI API 端点和密钥'
      };
    }

    // 发送流式对话请求
    const fullContent = await sendStreamingChatRequest(
      messages,
      {
        endpoint,
        apiKey,
        requestType,
        model,
        timeout
      },
      (chunk, accumulated) => {
        // 发送流式更新事件
        event.sender.send('ai-chat-streaming', {
          taskId: resolvedTaskId,
          chunk,
          accumulated
        });
      },
      req => {
        // 注册请求以便取消
        activeChatRequests.set(resolvedTaskId, req);
      }
    );

    activeChatRequests.delete(resolvedTaskId);

    return {
      success: true,
      content: fullContent,
      taskId: resolvedTaskId
    };
  } catch (error) {
    if (error && error.message === 'Cancelled') {
      activeChatRequests.delete(resolvedTaskId);
      return {
        success: false,
        cancelled: true,
        taskId: resolvedTaskId
      };
    }

    console.error('AI chat error:', error);
    activeChatRequests.delete(resolvedTaskId);
    return {
      success: false,
      error: error.message || '对话请求失败'
    };
  }
});

// 取消AI对话
ipcMain.on('cancel-ai-chat', (_event, { taskId }) => {
  if (!taskId) return;
  const req = activeChatRequests.get(taskId);
  if (!req) return;
  activeChatRequests.delete(taskId);
  try {
    if (req && typeof req.destroy === 'function') {
      req.destroy(new Error('Cancelled'));
    }
  } catch (error) {
    console.error('Cancel AI chat failed:', error);
  }
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
            contents.loadURL(url);
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

  // 处理下载事件
  mainWindow.webContents.session.on('will-download', (event, item) => {
    const downloadId = `d_${Date.now()}_${downloadSeq++}`;
    const fileName = item.getFilename();
    const fileSize = item.getTotalBytes();

    // 存储下载项
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

  // 加载HTML文件
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 开发模式下打开开发者工具
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
