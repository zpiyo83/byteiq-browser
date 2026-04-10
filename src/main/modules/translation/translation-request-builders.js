/**
 * 翻译请求构建模块
 * 构建不同格式的翻译请求体、请求头、请求路径
 */

// 翻译配置常量
const TRANSLATION_CONFIG = {
  MAX_TEXTS_PER_REQUEST: 500,
  MAX_CHARS_PER_REQUEST: 50000,
  REQUEST_TIMEOUT: 120000
};

/**
 * 构建 OpenAI Chat 兼容格式的请求体
 */
function buildOpenAIChatRequest(texts, targetLanguage, model = 'gpt-3.5-turbo', stream = false) {
  const textsJson = JSON.stringify(texts);
  return {
    model,
    messages: [
      {
        role: 'system',
        content: `You are a professional translator. Translate the following JSON array of texts to ${targetLanguage}. Return ONLY a valid JSON array with the same number of elements, maintaining the original order. Do not add any explanation or markdown formatting.`
      },
      {
        role: 'user',
        content: textsJson
      }
    ],
    max_tokens: 8192,
    temperature: 0.3,
    stream
  };
}

/**
 * 构建 OpenAI Response 格式的请求体
 */
function buildOpenAIResponseRequest(texts, targetLanguage, model = 'gpt-4') {
  const textsJson = JSON.stringify(texts);
  return {
    model,
    input: `Translate the following JSON array of texts to ${targetLanguage}. Return ONLY a valid JSON array with the same number of elements, maintaining the original order.\n\n${textsJson}`
  };
}

/**
 * 构建 Anthropic 格式的请求体
 */
function buildAnthropicRequest(texts, targetLanguage, model = 'claude-3-sonnet-20240229') {
  const textsJson = JSON.stringify(texts);
  return {
    model,
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: `Translate the following JSON array of texts to ${targetLanguage}. Return ONLY a valid JSON array with the same number of elements, maintaining the original order. Do not add any explanation or markdown formatting.\n\n${textsJson}`
      }
    ]
  };
}

/**
 * 解析 API 响应
 */
function parseAPIResponse(data, requestType) {
  try {
    const parsed = JSON.parse(data);

    switch (requestType) {
      case 'openai-chat':
      case 'openai-response':
        if (parsed.choices && parsed.choices[0]?.message?.content) {
          return JSON.parse(parsed.choices[0].message.content);
        }
        if (parsed.output) {
          return JSON.parse(parsed.output);
        }
        throw new Error('Invalid OpenAI response format');

      case 'anthropic':
        if (parsed.content && parsed.content[0]?.text) {
          return JSON.parse(parsed.content[0].text);
        }
        throw new Error('Invalid Anthropic response format');

      default:
        throw new Error(`Unknown request type: ${requestType}`);
    }
  } catch (error) {
    throw new Error(`Failed to parse translation response: ${error.message}`);
  }
}

/**
 * 获取请求头
 */
function getHeaders(requestType, apiKey) {
  const headers = {
    'Content-Type': 'application/json'
  };

  switch (requestType) {
    case 'openai-chat':
    case 'openai-response':
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
    case 'anthropic':
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      break;
  }

  return headers;
}

function getStreamingHeaders(requestType, apiKey) {
  return {
    ...getHeaders(requestType, apiKey),
    Accept: 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache'
  };
}

/**
 * 获取请求路径
 */
function getRequestPath(endpoint, requestType) {
  const url = new URL(endpoint);
  const path = url.pathname;

  if (
    path.includes('/chat/completions') ||
    path.includes('/responses') ||
    path.includes('/messages')
  ) {
    return path + url.search;
  }

  switch (requestType) {
    case 'openai-chat':
      return '/v1/chat/completions';
    case 'openai-response':
      return '/v1/responses';
    case 'anthropic':
      return '/v1/messages';
    default:
      return '/v1/chat/completions';
  }
}

module.exports = {
  TRANSLATION_CONFIG,
  buildOpenAIChatRequest,
  buildOpenAIResponseRequest,
  buildAnthropicRequest,
  parseAPIResponse,
  getHeaders,
  getStreamingHeaders,
  getRequestPath
};
