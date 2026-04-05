/**
 * AI 消息渲染与滚动管理
 */

const { createStreamingThinkParser } = require('./ai-think-parser');

function createAiMessageUI(options) {
  const { aiChatArea, documentRef, t } = options;

  // 流式思考解析器实例映射
  const streamingParsers = new WeakMap();

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function syncThinkContentHeight(content, expanded) {
    if (!content) return;
    if (!expanded) {
      content.style.maxHeight = '0px';
      content.classList.remove('show');
      return;
    }

    const height = content.scrollHeight || 0;
    const duration = clamp(Math.round(height * 0.4), 180, 320);
    content.style.setProperty('--think-duration', `${duration}ms`);
    content.style.maxHeight = `${height}px`;
    content.classList.add('show');
  }

  /**
   * 滚动到底部
   */
  function scrollToBottom() {
    aiChatArea.scrollTop = aiChatArea.scrollHeight;
  }

  /**
   * 创建思考下拉框组件
   * @param {boolean} isThinking - 是否正在思考中
   * @returns {HTMLElement}
   */
  function createThinkDropdown(isThinking = false) {
    const container = documentRef.createElement('div');
    container.className = 'think-dropdown';
    if (isThinking) {
      container.classList.add('thinking', 'expanded');
    }

    const header = documentRef.createElement('div');
    header.className = 'think-dropdown-header';
    header.innerHTML = `
      <span class="think-label">${isThinking ? 'Thinking' : 'Thoughts'}</span>
      <span class="think-toggle">${isThinking ? '▲' : '▼'}</span>
    `;

    const content = documentRef.createElement('div');
    content.className = 'think-dropdown-content';

    header.addEventListener('click', () => {
      const isExpanded = container.classList.toggle('expanded');
      const toggle = header.querySelector('.think-toggle');
      if (toggle) {
        toggle.textContent = isExpanded ? '▲' : '▼';
      }
      syncThinkContentHeight(content, isExpanded);
    });

    container.appendChild(header);
    container.appendChild(content);

    return { container, header, content };
  }

  /**
   * 添加聊天消息到UI
   */
  function addChatMessage(text, sender, isStreaming = false) {
    const msg = documentRef.createElement('div');
    msg.className = `chat-message ${sender}`;
    if (isStreaming) {
      msg.classList.add('streaming');
      // 添加 working 指示器
      const indicator = documentRef.createElement('span');
      indicator.className = 'streaming-indicator';
      indicator.textContent = 'working';
      msg.appendChild(indicator);
    }

    // 解析思考内容
    const { parseThinkingContent } = require('./ai-think-parser');
    const parsed = parseThinkingContent(text);

    if (parsed.thinking) {
      // 有思考内容，创建带下拉框的消息
      const { container, content } = createThinkDropdown(parsed.isThinking);
      content.textContent = parsed.thinking;
      msg.appendChild(container);

      const contentDiv = documentRef.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.textContent = parsed.content;
      msg.appendChild(contentDiv);

      // 存储解析器实例用于流式更新
      if (isStreaming) {
        const parser = createStreamingThinkParser();
        streamingParsers.set(msg, parser);
      }
      requestAnimationFrame(() => syncThinkContentHeight(content, parsed.isThinking));
    } else {
      if (isStreaming) {
        const contentDiv = documentRef.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = text || '';
        msg.appendChild(contentDiv);
      } else {
        msg.innerText = text;
      }
    }

    aiChatArea.appendChild(msg);
    scrollToBottom();

    return msg;
  }

  function updateStreamingMessage(element, text) {
    if (!element) return;

    // 获取或创建解析器
    let parser = streamingParsers.get(element);
    if (!parser) {
      parser = createStreamingThinkParser();
      streamingParsers.set(element, parser);
    }

    // 重置解析器并重新解析完整内容
    parser.reset();
    const result = parser.append(text);
    const finalResult = parser.finish();

    // 检查是否已有思考下拉框
    const existingDropdown = element.querySelector('.think-dropdown');
    const existingContent = element.querySelector('.message-content');
    const indicator = element.querySelector('.streaming-indicator');

    const isThinking = result.isThinking || !result.thinkingComplete;

    // 1. 处理思考部分
    if (finalResult.thinking) {
      if (!existingDropdown) {
        // 首次创建思考下拉框
        const { container, content } = createThinkDropdown(isThinking);
        content.textContent = finalResult.thinking;

        if (isThinking) {
          container.classList.add('expanded', 'thinking');
          const toggle = container.querySelector('.think-toggle');
          if (toggle) toggle.textContent = '▲';
          requestAnimationFrame(() => syncThinkContentHeight(content, true));
        }

        // 插入到最前面，或者在 indicator 之后
        if (indicator) {
          indicator.after(container);
        } else {
          element.prepend(container);
        }
      } else {
        // 更新现有思考内容
        const contentEl = existingDropdown.querySelector('.think-dropdown-content');
        if (contentEl) {
          contentEl.textContent = finalResult.thinking;
          const isExpanded = existingDropdown.classList.contains('expanded');
          if (isExpanded) {
            requestAnimationFrame(() => syncThinkContentHeight(contentEl, true));
          }
        }
        // 保持展开状态（如果正在思考）
        if (isThinking && !existingDropdown.classList.contains('expanded')) {
          existingDropdown.classList.add('expanded', 'thinking');
          const toggle = existingDropdown.querySelector('.think-toggle');
          if (toggle) toggle.textContent = '▲';
          const contentEl = existingDropdown.querySelector('.think-dropdown-content');
          if (contentEl) {
            requestAnimationFrame(() => syncThinkContentHeight(contentEl, true));
          }
        }
      }
    }

    // 2. 处理正文部分
    if (finalResult.content) {
      if (!existingContent) {
        const contentDiv = documentRef.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = finalResult.content;
        element.appendChild(contentDiv);
      } else {
        existingContent.textContent = finalResult.content;
      }
    } else if (existingContent) {
      existingContent.remove();
    }

    // 3. 处理 working 指示器逻辑
    const hasAnyContent = finalResult.thinking || finalResult.content;
    const shouldShowIndicator = !hasAnyContent;
    element.classList.add('streaming');
    if (shouldShowIndicator) {
      if (!indicator) {
        const newIndicator = documentRef.createElement('span');
        newIndicator.className = 'streaming-indicator';
        newIndicator.textContent = 'working';
        element.prepend(newIndicator);
      }
    } else if (indicator) {
      indicator.remove();
    }

    scrollToBottom();
  }

  /**
   * 完成流式消息（思考完成后收起下拉框）
   */
  function finishStreamingMessage(element) {
    if (!element) return;

    const dropdown = element.querySelector('.think-dropdown');
    if (dropdown) {
      dropdown.classList.remove('thinking');
      dropdown.classList.add('thought');

      // 更新标签
      const label = dropdown.querySelector('.think-label');
      if (label) {
        label.textContent = 'Thoughts';
      }

      // 收起下拉框
      dropdown.classList.remove('expanded');
      const content = dropdown.querySelector('.think-dropdown-content');
      if (content) {
        syncThinkContentHeight(content, false);
      }
      const toggle = dropdown.querySelector('.think-toggle');
      if (toggle) {
        toggle.textContent = '▼';
      }
    }

    element.classList.remove('streaming');
    const indicator = element.querySelector('.streaming-indicator');
    if (indicator) {
      indicator.remove();
    }

    // 清理解析器
    streamingParsers.delete(element);
  }

  /**
   * 清空聊天区域
   */
  function clearChatArea() {
    aiChatArea.innerHTML = '';
    const welcomeMsg = documentRef.createElement('div');
    welcomeMsg.className = 'chat-message ai';
    welcomeMsg.innerHTML = `<span>${t('ai.welcome')}</span>`;
    aiChatArea.appendChild(welcomeMsg);
  }

  return {
    addChatMessage,
    updateStreamingMessage,
    finishStreamingMessage,
    scrollToBottom,
    clearChatArea
  };
}

module.exports = {
  createAiMessageUI
};
