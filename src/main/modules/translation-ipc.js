const { callAITranslation } = require('./translation/ai-translator');
const { translateTextWithBing } = require('./translation/bing-translator');

function registerTranslationIpcHandlers(options) {
  const { app, ipcMain } = options;

  ipcMain.handle('get-version-info', () => {
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromiumVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      v8Version: process.versions.v8
    };
  });

  ipcMain.handle('translate-text-batch', async (event, payload = {}) => {
    const { engine, texts, targetLanguage } = payload || {};

    if (engine !== 'bing') {
      return { ok: false, message: 'Only Bing translator is supported' };
    }

    if (!Array.isArray(texts) || texts.length === 0) {
      return { ok: true, translations: [] };
    }

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
      for (let i = 0; i < safeTexts.length; i += 1) {
        const translated = await translateTextWithBing(safeTexts[i], to);
        translations.push(translated);
      }

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
}

module.exports = {
  registerTranslationIpcHandlers
};
