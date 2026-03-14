/**
 * AI 侧边栏事件绑定
 */

function bindAiSidebarResize(options) {
  const { documentRef, resizeHandle, aiSidebar } = options;
  if (!resizeHandle) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizeHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    startX = e.clientX;
    startWidth = aiSidebar.offsetWidth;
    documentRef.body.style.cursor = 'ew-resize';
    documentRef.body.style.userSelect = 'none';
    documentRef.body.style.pointerEvents = 'none';
  });

  const handleMouseMove = e => {
    if (!isResizing) return;
    const diff = startX - e.clientX;
    const newWidth = Math.min(600, Math.max(280, startWidth + diff));
    aiSidebar.style.width = `${newWidth}px`;
  };

  const handleMouseUp = () => {
    if (isResizing) {
      isResizing = false;
      documentRef.body.style.cursor = '';
      documentRef.body.style.userSelect = '';
      documentRef.body.style.pointerEvents = '';
    }
  };

  documentRef.addEventListener('mousemove', handleMouseMove);
  documentRef.addEventListener('mouseup', handleMouseUp);
}

function bindAskSelectionEvent(options) {
  const {
    windowRef,
    aiSidebar,
    aiInput,
    getActiveTabId,
    documentRef,
    t,
    showToast,
    getCurrentSession,
    updateSession,
    updateContextBar,
    renderSessionsList,
    renderSessionChat,
    scrollToBottom,
    buildSelectionContext
  } = options;

  windowRef.addEventListener('ai-ask-selection', async e => {
    const text = e?.detail?.text || '';
    const selectionContext = buildSelectionContext({
      text,
      getActiveTabId,
      documentRef,
      t
    });
    if (!selectionContext) {
      if (showToast) {
        showToast(t('ai.noSelection') || '未检测到选区文本', 'info');
      }
      return;
    }

    const wasCollapsed = aiSidebar.classList.contains('collapsed');
    aiSidebar.classList.remove('collapsed');

    const session = await getCurrentSession();
    if (session) {
      await updateSession(session.id, { pageContext: selectionContext });
    }
    updateContextBar(selectionContext);

    await renderSessionsList();
    await renderSessionChat(await getCurrentSession());

    if (wasCollapsed) {
      scrollToBottom();
    }

    if (aiInput) {
      aiInput.value =
        t('ai.defaultAskSelection') || '请解释并总结这段选区内容，并回答其中关键问题。';
      aiInput.focus();
    }
  });
}

module.exports = {
  bindAiSidebarResize,
  bindAskSelectionEvent
};
