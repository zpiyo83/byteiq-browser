/**
 * AI 翻译引擎模块入口
 * 重新导出子模块的接口
 */

let translateTexts,
  translateTextsStreaming,
  chunkTexts,
  sendStreamingRequest,
  sendRequest,
  TRANSLATION_CONFIG;

try {
  const translationSenders = require('./translation-senders');
  translateTexts = translationSenders.translateTexts;
  translateTextsStreaming = translationSenders.translateTextsStreaming;
  chunkTexts = translationSenders.chunkTexts;
  sendStreamingRequest = translationSenders.sendStreamingRequest;
  sendRequest = translationSenders.sendRequest;
  TRANSLATION_CONFIG = translationSenders.TRANSLATION_CONFIG;
} catch (error) {
  console.warn('AI translation module failed to load:', error.message);

  // 提供降级实现
  const createFallbackFunction = name => {
    return (..._args) => {
      throw new Error(`AI translation feature ${name} is not available. Module failed to load.`);
    };
  };

  translateTexts = createFallbackFunction('translateTexts');
  translateTextsStreaming = createFallbackFunction('translateTextsStreaming');
  chunkTexts = createFallbackFunction('chunkTexts');
  sendStreamingRequest = createFallbackFunction('sendStreamingRequest');
  sendRequest = createFallbackFunction('sendRequest');
  TRANSLATION_CONFIG = {};
}

module.exports = {
  translateTexts,
  translateTextsStreaming,
  chunkTexts,
  sendStreamingRequest,
  sendRequest,
  TRANSLATION_CONFIG
};
