/**
 * AI 上下文压缩管理器
 * 负责对话历史压缩功能
 */

/**
 * 创建上下文压缩管理器
 * @param {Object} options
 * @param {Object} options.ipcRenderer - IPC 渲染器
 * @param {Document} options.documentRef - 文档引用
 * @param {Object} options.agentRunner - Agent 运行器实例
 * @param {Object} options.historyStorage - 历史存储
 * @param {Function} options.showToast - 显示提示
 * @param {Function} options.getCurrentSession - 获取当前会话
 * @param {Function} options.renderSessionChat - 渲染会话聊天
 * @param {Function} options.estimateHistoryTokens - 估算历史 token
 * @param {Function} options.updateContextPie - 更新饼图
 */
function createContextCompress(options) {
  const {
    ipcRenderer,
    documentRef,
    agentRunner,
    historyStorage,
    showToast,
    getCurrentSession,
    renderSessionChat,
    estimateHistoryTokens,
    updateContextPie
  } = options;

  // 压缩上下文：将当前对话历史发送给 AI 进行摘要压缩
  async function compressContext() {
    const overlay = documentRef.getElementById('ai-compress-overlay');
    const content = documentRef.getElementById('ai-compress-content');
    const status = documentRef.getElementById('ai-compress-status');
    if (!overlay || !content || !status) return;

    // 获取当前消息历史
    const messages = agentRunner.getMessageHistory();
    if (!messages || messages.length <= 1) {
      showToast('没有足够的对话历史可以压缩', 'warning');
      return;
    }

    // 计算压缩前的 token 数
    const { total: beforeTokens } = estimateHistoryTokens(messages);

    // 显示弹窗
    overlay.style.display = 'flex';
    content.textContent = '';
    status.className = 'ai-compress-status';
    status.innerHTML = '<div class="ai-compress-spinner"></div><span>正在压缩...</span>';

    // 构造压缩 prompt
    const compressMessages = [
      {
        role: 'system',
        content:
          '你是一个对话压缩助手。请将以下对话历史压缩为简洁的摘要，保留所有关键信息、决策和结论。' +
          '直接输出压缩后的摘要文本，不要添加额外说明。' +
          '摘要应该足够详细，使得 AI 在后续对话中能够理解之前的上下文。'
      },
      {
        role: 'user',
        content:
          '请压缩以下对话历史：\n\n' +
          messages
            .filter(m => m.role !== 'system')
            .map(m => {
              const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? 'AI' : '工具';
              const text =
                typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
              return `[${role}]: ${text}`;
            })
            .join('\n\n')
      }
    ];

    // 使用独立的 taskId 跟踪压缩请求
    const compressTaskId = `compress-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let accumulated = '';

    // 临时监听压缩流式响应
    const onStreaming = (_event, data) => {
      if (data.taskId !== compressTaskId) return;
      accumulated = data.accumulated || accumulated + (data.chunk || '');
      // 使用 requestAnimationFrame 确保 DOM 更新立即渲染
      requestAnimationFrame(() => {
        content.textContent = accumulated;
        content.scrollTop = content.scrollHeight;
      });
    };
    ipcRenderer.on('ai-chat-streaming', onStreaming);

    try {
      const result = await ipcRenderer.invoke('ai-chat', {
        messages: compressMessages,
        taskId: compressTaskId
      });

      // 移除临时监听
      ipcRenderer.removeListener('ai-chat-streaming', onStreaming);

      if (result.success) {
        const compressedContent = result.content || accumulated;

        // 确保弹窗中显示最终的压缩结果
        if (compressedContent && content.textContent !== compressedContent) {
          content.textContent = compressedContent;
          content.scrollTop = content.scrollHeight;
        }

        // 计算压缩后的 token 数
        const compressedMessages = [
          messages[0], // 保留 system prompt
          { role: 'user', content: '[上下文摘要]' },
          { role: 'assistant', content: compressedContent }
        ];
        const { total: afterTokens } = estimateHistoryTokens(compressedMessages);
        const saved = beforeTokens - afterTokens;

        // 更新 agentRunner 的消息历史
        agentRunner.setMessageHistory(compressedMessages);

        // 更新 IndexedDB 中的消息
        const session = await getCurrentSession();
        if (session) {
          // 清除旧消息
          await historyStorage.clearMessages(session.id);
          // 保存压缩后的消息
          for (const msg of compressedMessages) {
            await historyStorage.addMessage(session.id, {
              role: msg.role,
              content: msg.content,
              metadata: msg.role === 'assistant' ? { compressed: true } : {}
            });
          }
        }

        // 重新渲染聊天区域
        await renderSessionChat(session);

        // 更新饼图
        updateContextPie();

        // 显示完成状态
        status.className = 'ai-compress-status completed';
        const savedK = (saved / 1000).toFixed(1);
        status.innerHTML = `<span>✓ 已完成压缩，节省 ${savedK}K tokens</span>`;

        // 2秒后自动关闭弹窗
        setTimeout(() => {
          overlay.style.display = 'none';
        }, 2000);
      } else {
        throw new Error(result.error || '压缩失败');
      }
    } catch (err) {
      ipcRenderer.removeListener('ai-chat-streaming', onStreaming);
      status.className = 'ai-compress-status';
      status.innerHTML = `<span style="color: #ef4444">压缩失败: ${err.message}</span>`;
      // 3秒后关闭
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 3000);
    }
  }

  return {
    compressContext
  };
}

module.exports = {
  createContextCompress
};
