/**
 * AI 侧边栏事件绑定
 */

function bindAiSidebarResize(options) {
  const { documentRef, resizeHandle, aiSidebar } = options;
  if (!resizeHandle || !aiSidebar) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;
  let rafId = null;
  let pendingWidth = null;

  // 保存原始样式值以便精确恢复
  const originalStyles = {
    cursor: documentRef.body.style.cursor,
    userSelect: documentRef.body.style.userSelect
  };

  const MIN_WIDTH = 280;
  const MAX_WIDTH = 600;

  const applyWidth = () => {
    if (pendingWidth !== null) {
      aiSidebar.style.width = `${pendingWidth}px`;
      pendingWidth = null;
    }
    rafId = null;
  };

  const handleMove = clientX => {
    if (!isResizing) return;
    const diff = startX - clientX;
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + diff));

    // 使用 RAF 优化渲染性能
    if (pendingWidth !== newWidth) {
      pendingWidth = newWidth;
      if (!rafId) {
        rafId = requestAnimationFrame(applyWidth);
      }
    }
  };

  const startResize = (clientX, event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    isResizing = true;
    startX = clientX;
    startWidth = aiSidebar.offsetWidth;

    // 添加拖动状态类（用于视觉反馈）
    resizeHandle.classList.add('resizing');
    aiSidebar.classList.add('resizing');
    documentRef.body.classList.add('ai-sidebar-resizing');

    // 只对调整手柄应用光标样式，避免全局副作用
    resizeHandle.style.cursor = 'ew-resize';
    documentRef.body.style.cursor = 'ew-resize';
    documentRef.body.style.userSelect = 'none';
  };

  const stopResize = () => {
    if (!isResizing) return;
    isResizing = false;

    // 取消未执行的 RAF
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingWidth = null;

    // 移除拖动状态类
    resizeHandle.classList.remove('resizing');
    aiSidebar.classList.remove('resizing');
    documentRef.body.classList.remove('ai-sidebar-resizing');

    // 恢复样式
    resizeHandle.style.cursor = '';
    documentRef.body.style.cursor = originalStyles.cursor;
    documentRef.body.style.userSelect = originalStyles.userSelect;
  };

  // 鼠标事件
  resizeHandle.addEventListener('mousedown', e => {
    startResize(e.clientX, e);
  });

  const handleMouseMove = e => {
    handleMove(e.clientX);
  };

  // 触摸事件支持
  const handleTouchStart = e => {
    if (e.touches.length === 1) {
      startResize(e.touches[0].clientX, e);
    }
  };

  const handleTouchMove = e => {
    if (e.touches.length === 1) {
      handleMove(e.touches[0].clientX);
    }
  };

  const handleTouchEnd = () => {
    stopResize();
  };

  resizeHandle.addEventListener('touchstart', handleTouchStart, { passive: false });
  resizeHandle.addEventListener('touchmove', handleTouchMove, { passive: false });
  resizeHandle.addEventListener('touchend', handleTouchEnd);
  resizeHandle.addEventListener('touchcancel', handleTouchEnd);

  documentRef.addEventListener('mousemove', handleMouseMove);
  documentRef.addEventListener('mouseup', stopResize);

  // 防止窗口失焦时卡住
  window.addEventListener('blur', stopResize);
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
