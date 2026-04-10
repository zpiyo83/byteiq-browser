/**
 * AI 对话模块入口
 * 重新导出子模块的接口
 */

let sendStreamingChatRequest,
  sendChatRequest,
  sendResponsesStreamForAgent,
  sendChatCompletionsStreamForAgent,
  buildOpenAIChatRequest;

try {
  const chatSenders = require('./chat/chat-senders');
  sendStreamingChatRequest = chatSenders.sendStreamingChatRequest;
  sendChatRequest = chatSenders.sendChatRequest;
  sendResponsesStreamForAgent = chatSenders.sendResponsesStreamForAgent;
  sendChatCompletionsStreamForAgent = chatSenders.sendChatCompletionsStreamForAgent;

  const requestBuilders = require('./chat/request-builders');
  buildOpenAIChatRequest = requestBuilders.buildOpenAIChatRequest;
} catch (error) {
  console.warn('AI chat module failed to load:', error.message);

  // 提供降级实现
  const createFallbackFunction = name => {
    return (..._args) => {
      throw new Error(`AI chat feature ${name} is not available. Module failed to load.`);
    };
  };

  sendStreamingChatRequest = createFallbackFunction('sendStreamingChatRequest');
  sendChatRequest = createFallbackFunction('sendChatRequest');
  sendResponsesStreamForAgent = createFallbackFunction('sendResponsesStreamForAgent');
  sendChatCompletionsStreamForAgent = createFallbackFunction('sendChatCompletionsStreamForAgent');
  buildOpenAIChatRequest = createFallbackFunction('buildOpenAIChatRequest');
}

module.exports = {
  sendStreamingChatRequest,
  sendChatRequest,
  sendResponsesStreamForAgent,
  sendChatCompletionsStreamForAgent,
  buildOpenAIChatRequest
};
