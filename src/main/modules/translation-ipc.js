// 翻译IPC处理器注册模块
const { callAITranslation } = require('./translation/ai-translator');
const { translateTextWithBing } = require('./translation/bing-translator');
const { diagnoseNetworkIssue } = require('./translation/network-diagnostics');

// 注册翻译相关的IPC处理器
function registerTranslationIpcHandlers(options) {
  const { app, ipcMain } = options;

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

  // 批量翻译文本
  ipcMain.handle('translate-text-batch', async (event, payload = {}) => {
    const { engine, texts, targetLanguage } = payload || {};

    // 目前只支持Bing翻译引擎
    if (engine !== 'bing') {
      return { ok: false, message: 'Only Bing translator is supported' };
    }

    // 验证输入参数
    if (!Array.isArray(texts) || texts.length === 0) {
      return { ok: true, translations: [] };
    }

    // 清理和验证文本
    const safeTexts = texts.map(item => String(item || '').trim());
    if (safeTexts.some(item => !item)) {
      return { ok: false, message: 'Source text cannot be empty' };
    }

    const to = String(targetLanguage || '').trim();
    if (!to) {
      return { ok: false, message: 'Missing target language' };
    }

    try {
      const translations = [];
      // 逐个翻译文本
      for (let i = 0; i < safeTexts.length; i += 1) {
        const translated = await translateTextWithBing(safeTexts[i], to);
        translations.push(translated);
      }

      // 验证翻译结果数量
      if (translations.length !== safeTexts.length) {
        return { ok: false, message: 'Translation response count mismatch' };
      }

      return {
        ok: true,
        translations
      };
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      console.error('[Bing翻译] 失败:', message);
      return { ok: false, message };
    }
  });

  ipcMain.handle('translate-text-ai', async (event, payload = {}) => {
    const { texts, targetLanguage, endpoint, apiKey, requestType, model, streaming } =
      payload || {};

    console.error('[AI翻译-IPC] 收到翻译请求:', {
      textsCount: texts?.length,
      targetLanguage,
      endpoint,
      apiKeyPresent: !!apiKey,
      requestType,
      model,
      streaming
    });

    if (!Array.isArray(texts) || texts.length === 0) {
      return { ok: true, translations: [] };
    }

    if (!endpoint || !apiKey) {
      console.error('[AI翻译] 缺少API端点或密钥');
      return { ok: false, message: '缺少AI翻译配置：API端点或密钥' };
    }

    const targetLangNames = {
      'zh-Hans': '简体中文',
      en: 'English',
      ja: '日本語',
      ko: '한국어',
      fr: 'Français',
      de: 'Deutsch',
      es: 'Español',
      ru: 'Русский'
    };
    const targetLangName = targetLangNames[targetLanguage] || targetLanguage;

    try {
      const senderWebContents = event.sender;
      const useStreaming = streaming !== false;

      const translations = await callAITranslation({
        texts,
        targetLanguage: targetLangName,
        endpoint,
        apiKey,
        requestType: requestType || 'openai-chat',
        model,
        senderWebContents,
        streaming: useStreaming
      });

      if (translations.length !== texts.length) {
        console.error('[AI翻译] 结果数量不匹配');
        return { ok: false, message: 'AI翻译结果数量不匹配' };
      }

      return {
        ok: true,
        translations
      };
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      console.error('[AI翻译] 失败:', message);
      return { ok: false, message };
    }
  });

  // 网络诊断
  ipcMain.handle('diagnose-translation-network', async (event, payload = {}) => {
    const { endpoint } = payload || {};

    if (!endpoint) {
      return { ok: false, message: '缺少API端点' };
    }

    try {
      console.error('[网络诊断] 开始诊断:', endpoint);
      const diagnostics = await diagnoseNetworkIssue(endpoint);
      console.error('[网络诊断] 诊断完成:', diagnostics);
      return { ok: true, diagnostics };
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      console.error('[网络诊断] 失败:', message);
      return { ok: false, message };
    }
  });
}

module.exports = {
  registerTranslationIpcHandlers
};
