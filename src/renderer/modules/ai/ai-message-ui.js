/**
 * AI 消息渲染与滚动管理
 */

function createAiMessageUI(options) {
  const { aiChatArea, documentRef, t } = options;

  /**
   * 滚动到底部
   */
  function scrollToBottom() {
    aiChatArea.scrollTop = aiChatArea.scrollHeight;
  }

  /**
   * 添加聊天消息到UI
   */
  function addChatMessage(text, sender, isStreaming = false) {
    const msg = documentRef.createElement('div');
    msg.className = `chat-message ${sender}`;
    if (isStreaming) {
      msg.classList.add('streaming');
    }

    msg.innerText = text;
    aiChatArea.appendChild(msg);
    scrollToBottom();

    return msg;
  }

  /**
   * 更新流式消息内容
   */
  function updateStreamingMessage(element, text) {
    if (!element) return;
    element.innerText = text;
    scrollToBottom();
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
    scrollToBottom,
    clearChatArea
  };
}

module.exports = {
  createAiMessageUI
};
