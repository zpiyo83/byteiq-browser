/**
 * AI 思考内容解析器
 * 支持 <!--think-->...<!--endthink--> 标签和 think 字段
 */

/**
 * 解析消息中的思考内容
 * 支持格式：
 * 1. <!--think-->思考内容<!--endthink-->
 * 2. <think>思考内容</think>
 * 3. 原始 think 字段（从API响应）
 *
 * @param {string} content - 消息内容
 * @returns {{ thinking: string, content: string, isThinking: boolean }}
 */
function parseThinkingContent(content) {
  if (!content || typeof content !== 'string') {
    return { thinking: '', content: content || '', isThinking: false };
  }

  let thinking = '';
  let remainingContent = content;
  let isThinking = false;

  // 匹配 <!--think-->...<!--endthink--> 格式
  const htmlCommentPattern = /<!--think-->([\s\S]*?)(?:<!--endthink-->|$)/;
  const htmlMatch = remainingContent.match(htmlCommentPattern);
  if (htmlMatch) {
    thinking = htmlMatch[1] || '';
    remainingContent = remainingContent.replace(htmlCommentPattern, '');
    // 检查是否有结束标签，如果没有说明还在思考中
    isThinking = !htmlMatch[0].includes('<!--endthink-->');
  }

  // 匹配 <think>...</think> 格式
  const xmlTagPattern = /<think>([\s\S]*?)(?:<\/think>|$)/;
  const xmlMatch = remainingContent.match(xmlTagPattern);
  if (xmlMatch) {
    thinking += (thinking ? '\n' : '') + (xmlMatch[1] || '');
    remainingContent = remainingContent.replace(xmlTagPattern, '');
    if (!xmlMatch[0].includes('</think>')) {
      isThinking = true;
    }
  }

  // 清理多余空白
  thinking = thinking.trim();
  remainingContent = remainingContent.trim();

  return {
    thinking,
    content: remainingContent,
    isThinking
  };
}

/**
 * 流式解析器状态
 */
function createStreamingThinkParser() {
  let buffer = '';
  let thinkingBuffer = '';
  let contentBuffer = '';
  let inThinkingBlock = false;
  let thinkingComplete = false;

  return {
    /**
     * 追加新内容并解析
     * @param {string} chunk - 新的内容块
     * @returns {{ thinking: string, content: string, thinkingDelta: string, contentDelta: string, isThinking: boolean, thinkingComplete: boolean }}
     */
    append(chunk) {
      if (!chunk) {
        return {
          thinking: thinkingBuffer,
          content: contentBuffer,
          thinkingDelta: '',
          contentDelta: '',
          isThinking: inThinkingBlock,
          thinkingComplete
        };
      }

      buffer += chunk;
      let thinkingDelta = '';
      let contentDelta = '';

      // 检测思考块开始
      if (!inThinkingBlock && !thinkingComplete) {
        const thinkStartPatterns = ['<!--think-->', '<think>'];

        for (const pattern of thinkStartPatterns) {
          if (buffer.includes(pattern)) {
            inThinkingBlock = true;
            // 移除开始标签
            buffer = buffer.replace(pattern, '');
            break;
          }
        }
      }

      // 在思考块中
      if (inThinkingBlock) {
        const thinkEndPatterns = [
          { pattern: '<!--endthink-->', len: 14 },
          { pattern: '</think>', len: 8 }
        ];

        let foundEnd = false;
        for (const { pattern, len } of thinkEndPatterns) {
          const endIndex = buffer.indexOf(pattern);
          if (endIndex !== -1) {
            // 提取思考内容（不包含结束标签）
            const thinkContent = buffer.substring(0, endIndex);
            thinkingBuffer += thinkContent;
            thinkingDelta = thinkContent;

            // 移除已处理的内容和结束标签
            buffer = buffer.substring(endIndex + len);

            inThinkingBlock = false;
            thinkingComplete = true;
            foundEnd = true;
            break;
          }
        }

        // 如果没有找到结束标签，继续缓冲思考内容
        if (!foundEnd) {
          // 保留最后几个字符以防标签被截断
          const keepLength = 20;
          const processLength = Math.max(0, buffer.length - keepLength);

          if (processLength > 0) {
            const toProcess = buffer.substring(0, processLength);
            thinkingBuffer += toProcess;
            thinkingDelta = toProcess;
            buffer = buffer.substring(processLength);
          }
        }
      }

      // 不在思考块中，作为普通内容处理
      if (!inThinkingBlock) {
        contentBuffer += buffer;
        contentDelta = buffer;
        buffer = '';
      }

      return {
        thinking: thinkingBuffer,
        content: contentBuffer,
        thinkingDelta,
        contentDelta,
        isThinking: inThinkingBlock,
        thinkingComplete
      };
    },

    /**
     * 结束解析，返回最终结果
     */
    finish() {
      // 处理剩余缓冲区
      if (buffer) {
        if (inThinkingBlock) {
          thinkingBuffer += buffer;
        } else {
          contentBuffer += buffer;
        }
        buffer = '';
      }

      return {
        thinking: thinkingBuffer.trim(),
        content: contentBuffer.trim(),
        thinkingComplete: true
      };
    },

    /**
     * 重置解析器状态
     */
    reset() {
      buffer = '';
      thinkingBuffer = '';
      contentBuffer = '';
      inThinkingBlock = false;
      thinkingComplete = false;
    },

    /**
     * 获取当前状态
     */
    getState() {
      return {
        thinking: thinkingBuffer,
        content: contentBuffer,
        isThinking: inThinkingBlock,
        thinkingComplete
      };
    }
  };
}

/**
 * 从API响应中提取思考内容
 * 支持 ollama-think、DeepSeek reasoning_content 等格式
 * @param {object} response - API响应对象
 * @returns {{ thinking: string, content: string }}
 */
function extractThinkingFromResponse(response) {
  if (!response) {
    return { thinking: '', content: '' };
  }

  // 支持直接的 thinking 字段
  if (response.thinking) {
    return {
      thinking: response.thinking,
      content: response.content || response.message?.content || ''
    };
  }

  // 支持 reasoning_content 字段（DeepSeek 等模型）
  if (response.reasoning_content) {
    return {
      thinking: response.reasoning_content,
      content: response.content || response.message?.content || ''
    };
  }

  // 支持 message.thinking 字段（ollama-think 格式）
  if (response.message?.thinking) {
    return {
      thinking: response.message.thinking,
      content: response.message.content || response.content || ''
    };
  }

  // 支持 message.reasoning_content 字段（DeepSeek 等模型）
  if (response.message?.reasoning_content) {
    return {
      thinking: response.message.reasoning_content,
      content: response.message.content || response.content || ''
    };
  }

  // 支持 choices[0].message.reasoning_content（OpenAI兼容格式）
  if (response.choices?.[0]?.message?.reasoning_content) {
    const choice = response.choices[0];
    return {
      thinking: choice.message.reasoning_content,
      content: choice.message.content || ''
    };
  }

  // 从内容中解析
  const content = response.content || response.message?.content || '';
  return parseThinkingContent(content);
}

module.exports = {
  parseThinkingContent,
  createStreamingThinkParser,
  extractThinkingFromResponse
};
