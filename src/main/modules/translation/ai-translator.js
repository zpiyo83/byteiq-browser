const https = require('https');

async function callAITranslation(options) {
  const { texts, targetLanguage, endpoint, apiKey, requestType, model, senderWebContents, streaming } = options;

  // 构建翻译请求
  let prompt = `请你帮我把以下文字翻译为${targetLanguage}，冒号后跟翻译后的内容，保持"翻译块:"的格式不变：\n`;
  texts.forEach((text, index) => {
    prompt += `翻译块: ${text}\n`;
  });

  let requestBody;
  let url = endpoint;

  // 根据请求类型设置默认模型
  const defaultModels = {
    'openai-chat': 'gpt-3.5-turbo',
    'openai-response': 'gpt-3.5-turbo-instruct',
    'anthropic': 'claude-3-haiku-20240307'
  };
  const actualModel = model || defaultModels[requestType] || defaultModels['openai-chat'];

  if (requestType === 'openai-chat') {
    // OpenAI Chat 兼容格式
    if (endpoint.endsWith('/chat/completions')) {
      url = endpoint;
    } else if (endpoint.endsWith('/v1') || endpoint.endsWith('/v1/')) {
      url = endpoint.replace(/\/$/, '') + '/chat/completions';
    } else {
      url = endpoint + (endpoint.endsWith('/') ? 'chat/completions' : '/chat/completions');
    }
    requestBody = {
      model: actualModel,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      stream: !!streaming
    };
  } else if (requestType === 'anthropic') {
    // Anthropic 格式
    if (endpoint.endsWith('/messages')) {
      url = endpoint;
    } else {
      url = endpoint + (endpoint.endsWith('/') ? 'messages' : '/messages');
    }
    requestBody = {
      model: actualModel,
      max_tokens: 4096,
      messages: [
        { role: 'user', content: prompt }
      ],
      stream: !!streaming
    };
  } else {
    // OpenAI Response 格式（简单文本补全）
    if (endpoint.endsWith('/completions')) {
      url = endpoint;
    } else {
      url = endpoint + (endpoint.endsWith('/') ? 'completions' : '/completions');
    }
    requestBody = {
      model: actualModel,
      prompt: prompt,
      max_tokens: 4096,
      temperature: 0.3,
      stream: !!streaming
    };
  }

  const bodyString = JSON.stringify(requestBody);
  const parsedUrl = new URL(url);

  // 如果是非流式模式，直接请求并解析
  if (!streaming) {
    return await callAITranslationNonStreaming({ url, parsedUrl, bodyString, apiKey, requestType, texts });
  }

  // 流式模式
  // 用于存储流式响应内容
  let fullContent = '';
  const translations = [];
  let lastSentCount = 0;

  // 解析并提取翻译块的辅助函数
  const parseAndNotify = (content) => {
    const lines = content.split('\n');
    // 流式响应时，最后一行可能还没输出完整（没有换行结尾），不要提前解析
    if (!content.endsWith('\n')) {
      lines.pop();
    }
    const newTranslations = [];

    for (const line of lines) {
      const match = line.match(/^翻译块:\s*(.+)$/);
      if (match) {
        newTranslations.push(match[1].trim());
      }
    }

    // 如果有新的翻译块，发送增量更新
    if (newTranslations.length > lastSentCount && senderWebContents) {
      const incremental = newTranslations.slice(lastSentCount);
      senderWebContents.send('translation-stream-update', {
        translations: newTranslations,
        incremental: incremental,
        startIndex: lastSentCount,
        total: texts.length
      });
      lastSentCount = newTranslations.length;
    }

    return newTranslations;
  };

  await new Promise((resolve, reject) => {
    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || undefined,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': requestType === 'anthropic' ? apiKey : undefined
      },
      rejectUnauthorized: false
    };

    // 移除undefined的header
    Object.keys(requestOptions.headers).forEach(key => {
      if (requestOptions.headers[key] === undefined) {
        delete requestOptions.headers[key];
      }
    });

    const request = https.request(requestOptions, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const errorText = Buffer.concat(chunks).toString('utf8');
          reject(new Error(`AI API请求失败 (${response.statusCode}): ${errorText.substring(0, 200)}`));
        });
        return;
      }

      let buffer = '';

      response.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留不完整的行

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // 处理 SSE 格式
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const json = JSON.parse(data);
              let contentDelta = '';

              if (requestType === 'anthropic') {
                // Anthropic stream format
                if (json.type === 'content_block_delta' && json.delta?.text) {
                  contentDelta = json.delta.text;
                }
              } else if (requestType === 'openai-response') {
                // OpenAI completions stream format
                contentDelta = json.choices?.[0]?.text || '';
              } else {
                // OpenAI chat stream format
                contentDelta = json.choices?.[0]?.delta?.content || '';
              }

              if (contentDelta) {
                fullContent += contentDelta;
                parseAndNotify(fullContent);
              }
            } catch (e) {
              // 忽略解析错误，可能是部分数据
            }
          } else if (trimmed.startsWith('event:')) {
            // 忽略事件类型行
            continue;
          }
        }
      });

      response.on('end', () => {
        resolve();
      });

      response.on('error', (error) => {
        console.error('[AI翻译] 响应错误:', error.message);
        reject(error);
      });
    });

    request.on('error', (error) => {
      console.error('[AI翻译] 请求错误:', error.message);
      reject(error);
    });

    request.write(bodyString);
    request.end();
  });

  // 最终解析翻译结果
  const finalTranslations = [];
  const lines = fullContent.split('\n');

  for (const line of lines) {
    const match = line.match(/^翻译块:\s*(.+)$/);
    if (match) {
      finalTranslations.push(match[1].trim());
    }
  }

  // 如果解析失败，尝试其他方式
  if (finalTranslations.length !== texts.length) {
    finalTranslations.length = 0;

    const allMatches = fullContent.match(/翻译块:\s*.+/g);
    if (allMatches && allMatches.length >= texts.length) {
      for (let i = 0; i < texts.length; i++) {
        const match = allMatches[i]?.match(/^翻译块:\s*(.+)$/);
        if (match) {
          finalTranslations.push(match[1].trim());
        }
      }
    }
  }

  if (finalTranslations.length !== texts.length) {
    console.error(`[AI翻译] 解析数量不匹配: 期望 ${texts.length}, 实际 ${finalTranslations.length}`);
    while (finalTranslations.length < texts.length) {
      finalTranslations.push(texts[finalTranslations.length]);
    }
  }

  return finalTranslations;
}

// 非流式翻译
async function callAITranslationNonStreaming(options) {
  const { parsedUrl, bodyString, apiKey, requestType, texts } = options;

  const result = await new Promise((resolve, reject) => {
    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || undefined,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyString),
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': requestType === 'anthropic' ? apiKey : undefined
      },
      rejectUnauthorized: false
    };

    // 移除undefined的header
    Object.keys(requestOptions.headers).forEach(key => {
      if (requestOptions.headers[key] === undefined) {
        delete requestOptions.headers[key];
      }
    });

    const request = https.request(requestOptions, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: response.statusCode || 500,
          bodyText: responseText
        });
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.write(bodyString);
    request.end();
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`AI API请求失败 (${result.statusCode}): ${result.bodyText.substring(0, 200)}`);
  }

  // 解析响应
  let responseContent = '';
  try {
    const jsonResponse = JSON.parse(result.bodyText);

    if (requestType === 'anthropic') {
      responseContent = jsonResponse.content?.[0]?.text || '';
    } else if (requestType === 'openai-response') {
      responseContent = jsonResponse.choices?.[0]?.text || '';
    } else {
      // OpenAI Chat 格式
      responseContent = jsonResponse.choices?.[0]?.message?.content || '';
    }
  } catch (parseError) {
    throw new Error('AI API响应解析失败');
  }

  // 解析翻译结果
  const finalTranslations = [];
  const lines = responseContent.split('\n');

  for (const line of lines) {
    const match = line.match(/^翻译块:\s*(.+)$/);
    if (match) {
      finalTranslations.push(match[1].trim());
    }
  }

  // 如果解析失败，尝试其他方式
  if (finalTranslations.length !== texts.length) {
    finalTranslations.length = 0;

    const allMatches = responseContent.match(/翻译块:\s*.+/g);
    if (allMatches && allMatches.length >= texts.length) {
      for (let i = 0; i < texts.length; i++) {
        const match = allMatches[i]?.match(/^翻译块:\s*(.+)$/);
        if (match) {
          finalTranslations.push(match[1].trim());
        }
      }
    }
  }

  if (finalTranslations.length !== texts.length) {
    console.error(`[AI翻译] 解析数量不匹配: 期望 ${texts.length}, 实际 ${finalTranslations.length}`);
    while (finalTranslations.length < texts.length) {
      finalTranslations.push(texts[finalTranslations.length]);
    }
  }

  return finalTranslations;
}

module.exports = {
  callAITranslation
};
