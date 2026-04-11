/**
 * AI 消息渲染与滚动管理
 */

const { createStreamingThinkParser } = require('./ai-think-parser');
const { renderMarkdownToElement } = require('./ai-markdown-renderer');

function createAiMessageUI(options) {
  const { aiChatArea, documentRef, t } = options;

  // 流式思考解析器实例映射
  const streamingParsers = new WeakMap();
  const autoCollapseTimers = new WeakMap();
  const THINK_MAX_LINES = 7;
  const THINK_MIN_EXPANDED_MS = 800;

  // 创建流式动画圆点指示器

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function cleanContent(text) {
    if (!text || typeof text !== 'string') return text;
    // 移除开头的 > 符号和可能的空格
    return text.replace(/^>\s*/, '');
  }

  function createStreamingDots() {
    const indicator = documentRef.createElement('div');
    indicator.className = 'streaming-indicator';
    const label = documentRef.createElement('span');
    label.className = 'streaming-label';
    label.textContent = 'Working';
    indicator.appendChild(label);
    return indicator;
  }

  /**
   * 渲染 AI 消息正文内容（Markdown → HTML）
   */
  function renderAiContent(element, text) {
    const cleaned = cleanContent(text);
    renderMarkdownToElement(element, cleaned, documentRef);
  }

  function getThinkLineHeight(content) {
    if (!content) return 0;
    const view = documentRef?.defaultView || window;
    if (!view?.getComputedStyle) return 0;
    const computed = view.getComputedStyle(content);
    const fontSize = parseFloat(computed.fontSize) || 12;
    const rawLineHeight = parseFloat(computed.lineHeight);
    if (Number.isFinite(rawLineHeight)) {
      return rawLineHeight;
    }
    return fontSize * 1.45;
  }

  function getThinkMaxHeightLimit(content) {
    const lineHeight = getThinkLineHeight(content);
    if (!lineHeight) return 0;
    const view = documentRef?.defaultView || window;
    let padding = 0;
    if (view?.getComputedStyle) {
      const computed = view.getComputedStyle(content);
      const paddingTop = parseFloat(computed.paddingTop) || 0;
      const paddingBottom = parseFloat(computed.paddingBottom) || 0;
      padding = paddingTop + paddingBottom;
    }
    return Math.round(lineHeight * THINK_MAX_LINES + padding);
  }

  function getThinkMaxHeight(content, lockToMax) {
    const limit = getThinkMaxHeightLimit(content);
    if (lockToMax || !content) return limit;
    const height = content.scrollHeight || 0;
    if (!height) return limit;
    return Math.min(height, limit);
  }

  function scrollThinkContentToBottom(content) {
    if (!content) return;
    content.scrollTop = content.scrollHeight;
  }

  function hasUserToggled(container) {
    return container?.dataset.userToggled === 'true';
  }

  function markUserToggled(container) {
    if (!container) return;
    container.dataset.userToggled = 'true';
  }

  function hasAutoCollapsed(container) {
    return container?.dataset.autoCollapsed === 'true';
  }

  function markAutoCollapsed(container) {
    if (!container) return;
    container.dataset.autoCollapsed = 'true';
  }

  function clearAutoCollapseTimer(container) {
    const timer = autoCollapseTimers.get(container);
    if (timer) {
      clearTimeout(timer);
      autoCollapseTimers.delete(container);
    }
  }

  function markAutoExpanded(container) {
    if (!container) return;
    container.dataset.autoExpandedAt = String(Date.now());
  }

  function getAutoExpandedAt(container) {
    if (!container) return 0;
    const value = Number(container.dataset.autoExpandedAt);
    return Number.isFinite(value) ? value : 0;
  }

  function scheduleAutoCollapse(container, contentEl) {
    if (!container || !contentEl) return;
    clearAutoCollapseTimer(container);

    const expandedAt = getAutoExpandedAt(container);
    const elapsed = expandedAt ? Date.now() - expandedAt : THINK_MIN_EXPANDED_MS;
    const remaining = Math.max(0, THINK_MIN_EXPANDED_MS - elapsed);
    const timer = setTimeout(() => {
      autoCollapseTimers.delete(container);
      if (hasUserToggled(container) || hasAutoCollapsed(container)) return;
      markAutoCollapsed(container);
      container.classList.remove('expanded');
      syncThinkContentHeight(contentEl, false);
      const toggle = container.querySelector('.think-toggle');
      if (toggle) {
        toggle.textContent = '▼';
      }
    }, remaining);
    autoCollapseTimers.set(container, timer);
  }

  function syncThinkContentHeight(content, expanded, lockToMax = false) {
    if (!content) return;
    const maxHeightLimit = getThinkMaxHeightLimit(content);
    if (maxHeightLimit) {
      content.style.setProperty('--think-max-height', `${maxHeightLimit}px`);
    }
    if (!expanded) {
      content.style.maxHeight = '0px';
      content.style.padding = '0';
      content.classList.remove('show');
      return;
    }

    const height = getThinkMaxHeight(content, lockToMax);
    const duration = clamp(Math.round(height * 0.4), 180, 320);
    content.style.setProperty('--think-duration', `${duration}ms`);
    content.style.maxHeight = `${height}px`;
    content.style.padding = '4px 0 4px 16px';
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
  function createThinkDropdown({ isThinking = false, expanded = false } = {}) {
    const container = documentRef.createElement('div');
    container.className = 'think-dropdown';
    if (isThinking) {
      container.classList.add('thinking');
    }
    if (expanded) {
      container.classList.add('expanded');
    }

    const header = documentRef.createElement('div');
    header.className = 'think-dropdown-header';
    header.innerHTML = `
      <span class="think-label">${isThinking ? 'Thinking' : 'Thoughts'}</span>
      <span class="think-toggle">${expanded ? '▲' : '▼'}</span>
    `;

    const content = documentRef.createElement('div');
    content.className = 'think-dropdown-content';

    header.addEventListener('click', () => {
      markUserToggled(container);
      const isExpanded = container.classList.toggle('expanded');
      const toggle = header.querySelector('.think-toggle');
      if (toggle) {
        toggle.textContent = isExpanded ? '▲' : '▼';
      }
      syncThinkContentHeight(content, isExpanded);
      if (isExpanded) {
        scrollThinkContentToBottom(content);
      }
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
      // 添加动画圆点指示器
      const indicator = createStreamingDots();
      msg.appendChild(indicator);
    }

    // 解析思考内容
    const { parseThinkingContent } = require('./ai-think-parser');
    const parsed = parseThinkingContent(text);

    if (parsed.thinking) {
      const hasContent = Boolean(parsed.content && parsed.content.trim());
      const shouldForceExpand = Boolean(isStreaming && parsed.isThinking && !hasContent);
      // 有思考内容，创建带下拉框的消息（先折叠，插入DOM后再展开触发动画）
      const { container, content } = createThinkDropdown({
        isThinking: parsed.isThinking,
        expanded: false
      });
      content.textContent = cleanContent(parsed.thinking);
      msg.appendChild(container);

      const contentDiv = documentRef.createElement('div');
      contentDiv.className = 'message-content';
      renderAiContent(contentDiv, parsed.content);
      msg.appendChild(contentDiv);

      // 存储解析器实例用于流式更新
      if (isStreaming) {
        const parser = createStreamingThinkParser();
        streamingParsers.set(msg, parser);
      }
      requestAnimationFrame(() => {
        if (shouldForceExpand) {
          container.classList.add('expanded');
          const toggle = container.querySelector('.think-toggle');
          if (toggle) toggle.textContent = '▲';
        }
        syncThinkContentHeight(content, shouldForceExpand, shouldForceExpand);
        if (shouldForceExpand) {
          scrollThinkContentToBottom(content);
        }
      });
    } else {
      if (isStreaming) {
        const contentDiv = documentRef.createElement('div');
        contentDiv.className = 'message-content';
        renderAiContent(contentDiv, text || '');
        msg.appendChild(contentDiv);
      } else if (sender === 'ai') {
        const contentDiv = documentRef.createElement('div');
        contentDiv.className = 'message-content';
        renderAiContent(contentDiv, text);
        msg.appendChild(contentDiv);
      } else {
        msg.innerText = cleanContent(text);
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
    const hasThinking = Boolean(finalResult.thinking);
    const hasContent = Boolean(finalResult.content && finalResult.content.trim());
    const shouldForceExpand = Boolean(hasThinking && isThinking && !hasContent);
    let dropdown = existingDropdown;

    // 1. 处理思考部分
    if (hasThinking) {
      if (!dropdown) {
        // 首次创建思考下拉框（先不展开，等插入DOM后再触发过渡动画）
        const { container, content } = createThinkDropdown({
          isThinking,
          expanded: false
        });
        content.textContent = cleanContent(finalResult.thinking);
        dropdown = container;

        container.classList.toggle('thinking', isThinking);

        // 插入到最前面，或者在 indicator 之后
        if (indicator) {
          indicator.after(container);
        } else {
          element.prepend(container);
        }

        // 下一帧展开，触发CSS过渡动画
        if (
          shouldForceExpand ||
          (hasContent && !hasUserToggled(dropdown) && !hasAutoCollapsed(dropdown))
        ) {
          requestAnimationFrame(() => {
            dropdown.classList.add('expanded');
            markAutoExpanded(dropdown);
            const toggle = dropdown.querySelector('.think-toggle');
            if (toggle) toggle.textContent = '▲';
            syncThinkContentHeight(content, true, true);
            scrollThinkContentToBottom(content);
          });
        }
      } else {
        // 更新现有思考内容
        dropdown.classList.toggle('thinking', isThinking);
        const label = dropdown.querySelector('.think-label');
        if (label) {
          label.textContent = isThinking ? 'Thinking' : 'Thoughts';
        }

        const contentEl = dropdown.querySelector('.think-dropdown-content');
        if (contentEl) {
          contentEl.textContent = cleanContent(finalResult.thinking);
          const isExpanded = dropdown.classList.contains('expanded');
          if (isExpanded) {
            const lockToMax = shouldForceExpand && !hasUserToggled(dropdown);
            requestAnimationFrame(() => {
              syncThinkContentHeight(contentEl, true, lockToMax);
              if (lockToMax) {
                scrollThinkContentToBottom(contentEl);
              }
            });
          }
        }
        // 思考阶段自动展开（尊重用户手动操作；若已自动折叠过则不再自动展开）
        if (shouldForceExpand && !dropdown.classList.contains('expanded')) {
          if (!hasUserToggled(dropdown) && !hasAutoCollapsed(dropdown)) {
            dropdown.classList.add('expanded');
            markAutoExpanded(dropdown);
            const toggle = dropdown.querySelector('.think-toggle');
            if (toggle) toggle.textContent = '▲';
            const contentEl = dropdown.querySelector('.think-dropdown-content');
            if (contentEl) {
              requestAnimationFrame(() => {
                syncThinkContentHeight(contentEl, true, true);
                scrollThinkContentToBottom(contentEl);
              });
            }
          }
        }
      }
    }

    // 2. 处理正文部分
    if (hasContent) {
      if (!existingContent) {
        const contentDiv = documentRef.createElement('div');
        contentDiv.className = 'message-content';
        renderAiContent(contentDiv, finalResult.content);
        element.appendChild(contentDiv);
      } else {
        renderAiContent(existingContent, finalResult.content);
      }
    } else if (existingContent) {
      existingContent.remove();
    }

    if (hasContent && dropdown) {
      if (!hasUserToggled(dropdown) && !hasAutoCollapsed(dropdown)) {
        const contentEl = dropdown.querySelector('.think-dropdown-content');
        if (contentEl) {
          scheduleAutoCollapse(dropdown, contentEl);
        }
      }
    }

    // 3. 处理 working 指示器逻辑
    const hasAnyContent = finalResult.thinking || finalResult.content;
    const shouldShowIndicator = !hasAnyContent;
    element.classList.add('streaming');
    if (shouldShowIndicator) {
      if (!indicator) {
        const newIndicator = createStreamingDots();
        element.prepend(newIndicator);
      }
    } else if (indicator) {
      indicator.remove();
    }

    scrollToBottom();
  }

  function autoCollapseThinkingDropdown(element) {
    if (!element) return;
    const dropdown = element.querySelector('.think-dropdown');
    if (!dropdown) return;
    if (hasUserToggled(dropdown) || hasAutoCollapsed(dropdown)) return;
    const thinkContent = dropdown.querySelector('.think-dropdown-content');
    if (!thinkContent) return;
    scheduleAutoCollapse(dropdown, thinkContent);
  }

  /**
   * 完成流式消息（思考完成后收起下拉框）
   */
  function finishStreamingMessage(element) {
    if (!element) return;

    const dropdown = element.querySelector('.think-dropdown');
    const contentEl = element.querySelector('.message-content');
    const hasContent = Boolean(
      contentEl &&
      ((contentEl.innerHTML && contentEl.innerHTML.trim()) ||
        (contentEl.childNodes && contentEl.childNodes.length > 0))
    );
    if (dropdown) {
      dropdown.classList.remove('thinking');
      dropdown.classList.add('thought');

      // 更新标签
      const label = dropdown.querySelector('.think-label');
      if (label) {
        label.textContent = 'Thoughts';
      }

      const thinkContent = dropdown.querySelector('.think-dropdown-content');
      if (hasContent && !hasUserToggled(dropdown)) {
        clearAutoCollapseTimer(dropdown);
        dropdown.classList.remove('expanded');
        markAutoCollapsed(dropdown);
        if (thinkContent) {
          syncThinkContentHeight(thinkContent, false);
        }
        const toggle = dropdown.querySelector('.think-toggle');
        if (toggle) {
          toggle.textContent = '▼';
        }
      } else if (thinkContent && dropdown.classList.contains('expanded')) {
        syncThinkContentHeight(thinkContent, true, false);
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
    welcomeMsg.className = 'chat-message ai welcome-message';
    welcomeMsg.innerHTML = `<div class="welcome-icon">✨</div><div class="welcome-text">${t('ai.welcome')}</div>`;
    aiChatArea.appendChild(welcomeMsg);
  }

  return {
    addChatMessage,
    updateStreamingMessage,
    finishStreamingMessage,
    autoCollapseThinkingDropdown,
    scrollToBottom,
    clearChatArea
  };
}

module.exports = {
  createAiMessageUI
};
