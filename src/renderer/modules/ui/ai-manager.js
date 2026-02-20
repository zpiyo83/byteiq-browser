function createAiManager(options) {
  const {
    aiChatArea,
    aiInput,
    aiSendBtn,
    aiSidebar,
    closeAiBtn,
    documentRef,
    getActiveTabId,
    t,
    toggleAiBtn
  } = options;

  function addChatMessage(text, sender) {
    const msg = documentRef.createElement('div');
    msg.className = `chat-message ${sender}`;
    msg.innerText = text;
    aiChatArea.appendChild(msg);
    aiChatArea.scrollTop = aiChatArea.scrollHeight;
  }

  function handleAISend() {
    const text = aiInput.value.trim();
    if (!text) return;

    addChatMessage(text, 'user');
    aiInput.value = '';

    setTimeout(() => {
      const currentWv = documentRef.getElementById(`webview-${getActiveTabId()}`);
      let response = t('ai.prototype');

      if (text.includes('总结') || text.includes('總結') || text.includes('summary')) {
        if (currentWv && currentWv.tagName === 'WEBVIEW') {
          response = t('ai.summaryPrompt');
        } else {
          response = t('ai.noPage');
        }
      }

      addChatMessage(response, 'ai');
    }, 600);
  }

  function bindEvents() {
    toggleAiBtn.style.display = 'flex';

    toggleAiBtn.addEventListener('click', () => {
      aiSidebar.classList.toggle('collapsed');
    });

    closeAiBtn.addEventListener('click', () => {
      aiSidebar.classList.add('collapsed');
    });

    aiSendBtn.addEventListener('click', handleAISend);
    aiInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') handleAISend();
    });
  }

  return {
    bindEvents
  };
}

module.exports = {
  createAiManager
};
