/**
 * AI Agent 工具调用循环处理
 * 封装 tool_calls 结果的渲染、执行、历史记录等逻辑
 */

const { renderMarkdownToElement } = require('../chat/ai-markdown-renderer');
const { truncateToolResult } = require('./ai-agent-utils');

/**
 * 创建工具循环处理器
 * @param {Object} deps - 依赖注入
 * @returns {{ handleToolCalls: Function }}
 */
function createToolLoopHandler(deps) {
  const {
    toolCardUI,
    toolsExecutor,
    addChatMessage,
    updateStreamingMessage,
    finishStreamingMessage,
    autoCollapseThinkingDropdown,
    historyStorage,
    contextIsolation,
    updateTaskState,
    getTaskState,
    getCurrentPageInfo,
    bindTabToSession,
    documentRef,
    handleBgTaskResult, // 新增: 处理后台任务结果回调
    handleWaitSeconds // 新增: 处理等待秒数回调
  } = deps;

  /**
   * 处理 tool_calls 类型的响应
   * @param {Object} params - 参数
   * @param {Object} params.result - API 返回的 tool_calls 结果
   * @param {HTMLElement} params.aiMsgElement - AI 消息 DOM 元素
   * @param {Object} params.session - 当前会话
   * @param {Array} params.agentMessageHistory - 消息历史（可变引用）
   * @returns {Promise<{ shouldBreak: boolean }>} 是否应中断循环
   */
  async function handleToolCalls({ result, aiMsgElement, session, agentMessageHistory }) {
    // 流式监听器已经把 AI 的思考+文字渲染到 aiMsgElement
    const hasStreamedContent =
      aiMsgElement.querySelector('.message-content') ||
      aiMsgElement.querySelector('.think-dropdown');
    if (hasStreamedContent) {
      finishStreamingMessage(aiMsgElement);
    } else if (result.content || result.reasoningContent) {
      const fullText = result.reasoningContent
        ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content || ''}`
        : result.content || '';
      updateStreamingMessage(aiMsgElement, fullText);
      finishStreamingMessage(aiMsgElement);
    } else {
      if (aiMsgElement.parentNode) {
        aiMsgElement.parentNode.removeChild(aiMsgElement);
      }
    }

    if (typeof autoCollapseThinkingDropdown === 'function' && hasStreamedContent) {
      autoCollapseThinkingDropdown(aiMsgElement);
    }

    const toolMessages = new Map();
    result.toolCalls.forEach(toolCall => {
      if (toolCall.name === 'end_session') {
        toolMessages.set(toolCall.id, null);
        return;
      }
      const target = addChatMessage('', 'ai');
      toolMessages.set(toolCall.id, target);
      toolCardUI.renderToolCard(target, {
        title: toolCardUI.getToolTitle(toolCall.name),
        description: toolCardUI.buildToolCallDescription(toolCall),
        status: 'pending',
        toolName: toolCall.name,
        args: toolCall.arguments
      });
    });

    const openAiToolCalls = result.toolCalls.map(call => ({
      id: call.id,
      type: 'function',
      function: {
        name: call.name,
        arguments: JSON.stringify(call.arguments || {})
      }
    }));

    agentMessageHistory.push({
      role: 'assistant',
      content: null,
      tool_calls: openAiToolCalls
    });

    // 保存带工具调用的助手消息到历史
    const assistantSavedContent = result.reasoningContent
      ? `<!--think-->${result.reasoningContent}<!--endthink-->${result.content || ''}`
      : result.content || '';
    if (contextIsolation?.isSessionActive?.(session.id)) {
      await historyStorage.addMessage(session.id, {
        role: 'assistant',
        content: assistantSavedContent,
        metadata: {
          thinkingContent: result.reasoningContent || '',
          actionContent: result.content || '',
          toolCalls: result.toolCalls.map(call => ({
            id: call.id,
            name: call.name,
            arguments: call.arguments
          }))
        }
      });
    }

    let shouldBreak = false;

    for (let ti = 0; ti < result.toolCalls.length; ti++) {
      const toolCall = result.toolCalls[ti];

      // 工具间间隔 3 秒（首个工具无延迟）
      if (ti > 0) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // 执行前更新卡片状态为 running（旋转动画）
      const runningTarget = toolMessages.get(toolCall.id);
      if (runningTarget && toolCall.name !== 'end_session') {
        toolCardUI.renderToolCard(runningTarget, {
          title: toolCardUI.getToolTitle(toolCall.name),
          description: toolCardUI.buildToolCallDescription(toolCall),
          status: 'running',
          toolName: toolCall.name,
          args: toolCall.arguments
        });
      }

      const toolResult = await toolsExecutor.execute(toolCall);

      // 特殊处理: 等待秒数
      if (toolCall.name === 'wait_seconds' && toolResult?.success && toolResult.waitMode) {
        const seconds = toolResult.waitSeconds;
        if (typeof handleWaitSeconds === 'function') {
          await handleWaitSeconds(seconds);
        }
      }

      // 对于 search_page 工具，将新创建的标签页绑定到当前会话
      if (
        toolCall.name === 'search_page' &&
        toolResult?.success &&
        toolResult?.tabId &&
        session?.id &&
        typeof bindTabToSession === 'function'
      ) {
        try {
          bindTabToSession(toolResult.tabId, session.id);
        } catch (error) {
          console.warn('[ai-agent-runner] Failed to bind tab to session:', error);
        }
      }

      const target = toolMessages.get(toolCall.id) || addChatMessage('', 'ai');

      if (toolCall.name === 'end_session') {
        // 将 summary 以 Markdown 渲染到消息区域
        const summaryText = toolCall.arguments?.summary || toolResult?.summary || '';
        if (summaryText) {
          const summaryMsg = addChatMessage('', 'ai');
          const contentDiv = documentRef.createElement('div');
          contentDiv.className = 'message-content';
          renderMarkdownToElement(contentDiv, summaryText, documentRef);
          summaryMsg.appendChild(contentDiv);
        }
        if (contextIsolation?.isSessionActive?.(session.id)) {
          const endTruncated = truncateToolResult(toolCall.name, toolResult);
          await historyStorage.addMessage(session.id, {
            role: 'tool',
            content: endTruncated.summary,
            metadata: {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              status: 'success',
              description: summaryText || '会话已结束'
            }
          });
        }
        shouldBreak = true;
        break;
      }

      const truncated = truncateToolResult(toolCall.name, toolResult);

      // 查找并更新 agentMessageHistory 中对应的 tool 消息
      const toolMsgIndex = agentMessageHistory.findIndex(
        msg => msg.role === 'tool' && msg.tool_call_id === toolCall.id
      );
      if (toolMsgIndex !== -1) {
        agentMessageHistory[toolMsgIndex].content = truncated.content;
      } else {
        agentMessageHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: truncated.content
        });
      }

      const summary = toolCardUI.buildToolResultSummary(toolCall, toolResult);
      toolCardUI.renderToolCard(target, {
        title: toolCardUI.getToolTitle(toolCall.name),
        description: summary.text,
        status: summary.status,
        toolName: toolCall.name,
        args: toolCall.arguments,
        toolResult
      });
      // 更新任务状态追踪
      if (typeof updateTaskState === 'function') {
        const steps =
          typeof getTaskState === 'function' && getTaskState()
            ? getTaskState().completedSteps || []
            : [];
        steps.push(`${toolCardUI.getToolTitle(toolCall.name)}: ${summary.text}`);
        const currentPageInfo =
          typeof getCurrentPageInfo === 'function' ? getCurrentPageInfo() : null;
        updateTaskState({
          completedSteps: steps,
          currentPage: currentPageInfo
            ? `${currentPageInfo.title || currentPageInfo.url}`
            : getTaskState()?.currentPage || '未知',
          lastAction: summary.text
        });
      }
      // 保存工具结果到历史（使用截断后的内容防止存储膨胀）
      if (contextIsolation?.isSessionActive?.(session.id)) {
        await historyStorage.addMessage(session.id, {
          role: 'tool',
          content: truncated.summary,
          metadata: {
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            status: summary.status,
            description: summary.text
          }
        });
      }
    }

    return { shouldBreak };
  }

  return { handleToolCalls };
}

module.exports = {
  createToolLoopHandler
};
