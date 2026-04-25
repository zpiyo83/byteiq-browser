/**
 * AI 侧边栏事件绑定
 */

function bindAiSidebarResize(options) {
  const { documentRef, resizeHandle, aiSidebar } = options;
  if (!resizeHandle || !aiSidebar) return;

  const webviewsContainer = documentRef.getElementById('webviews-container');

  let isResizing = false;

  // 暴露拖动状态查询接口，供外部判断是否正在拖动
  function getIsResizing() {
    return isResizing;
  }
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
  const MAX_WIDTH = 900;
  const DEFAULT_WIDTH = 360;
  const STORAGE_KEY = 'byteiq.aiSidebarWidth';

  // 恢复用户保存的宽度
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && !aiSidebar.classList.contains('collapsed')) {
      const w = parseInt(saved, 10);
      if (!Number.isNaN(w) && w >= MIN_WIDTH && w <= MAX_WIDTH) {
        aiSidebar.style.width = `${w}px`;
        if (webviewsContainer) {
          webviewsContainer.style.marginRight = `${w}px`;
        }
      }
    }
  } catch {
    // localStorage 可能不可用，静默忽略
  }

  const applyWidth = () => {
    if (pendingWidth !== null) {
      aiSidebar.style.width = `${pendingWidth}px`;
      // 同步更新webview容器边距，避免webview覆盖侧边栏
      if (webviewsContainer && !aiSidebar.classList.contains('collapsed')) {
        webviewsContainer.style.marginRight = `${pendingWidth}px`;
      }
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

  // 文档级事件处理器（在 startResize 前定义以确保可引用）
  const onMouseMove = e => {
    handleMove(e.clientX);
  };

  const onMouseUp = () => {
    stopResize();
  };

  const onMouseLeave = () => {
    stopResize();
  };

  const onTouchMove = e => {
    if (e.touches.length === 1) {
      handleMove(e.touches[0].clientX);
    }
  };

  const onTouchEnd = () => {
    stopResize();
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

    // 拖动时禁用侧边栏过渡，避免延迟
    if (webviewsContainer) {
      webviewsContainer.style.transition = 'none';
    }

    // 动态绑定 document 级事件，仅在拖动期间监听
    documentRef.addEventListener('mousemove', onMouseMove);
    documentRef.addEventListener('mouseup', onMouseUp);
    documentRef.addEventListener('touchmove', onTouchMove, { passive: false });
    documentRef.addEventListener('touchend', onTouchEnd);
    documentRef.addEventListener('touchcancel', onTouchEnd);
    if (documentRef.documentElement) {
      documentRef.documentElement.addEventListener('mouseleave', onMouseLeave);
    }
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

    // 恢复webview容器过渡
    if (webviewsContainer) {
      webviewsContainer.style.transition = '';
    }

    // 解绑 document 级事件
    documentRef.removeEventListener('mousemove', onMouseMove);
    documentRef.removeEventListener('mouseup', onMouseUp);
    documentRef.removeEventListener('touchmove', onTouchMove, { passive: false });
    documentRef.removeEventListener('touchend', onTouchEnd);
    documentRef.removeEventListener('touchcancel', onTouchEnd);
    if (documentRef.documentElement) {
      documentRef.documentElement.removeEventListener('mouseleave', onMouseLeave);
    }

    // 持久化最终宽度
    const finalWidth = aiSidebar.offsetWidth;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(finalWidth));
    } catch {
      // 静默忽略
    }
  };

  // 鼠标事件
  resizeHandle.addEventListener('mousedown', e => {
    startResize(e.clientX, e);
  });

  // 触摸事件支持（仅 start 绑定在 handle 上，move/end 在 document 上动态绑定）
  resizeHandle.addEventListener(
    'touchstart',
    e => {
      if (e.touches.length === 1) {
        startResize(e.touches[0].clientX, e);
      }
    },
    { passive: false }
  );

  // 双击恢复默认宽度
  resizeHandle.addEventListener('dblclick', () => {
    aiSidebar.style.width = `${DEFAULT_WIDTH}px`;
    if (webviewsContainer && !aiSidebar.classList.contains('collapsed')) {
      webviewsContainer.style.marginRight = `${DEFAULT_WIDTH}px`;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH));
    } catch {
      // 静默忽略
    }
  });

  // 防止窗口失焦时卡住
  window.addEventListener('blur', stopResize);

  // 注册拖动状态查询接口到模块，供 ai-page-context 使用
  module.exports._sidebarResizingGetter = getIsResizing;
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

  const webviewsContainer = documentRef.getElementById('webviews-container');

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

    // 同步webview容器边距
    if (wasCollapsed && webviewsContainer) {
      const width = aiSidebar.offsetWidth || 360;
      webviewsContainer.style.marginRight = `${width}px`;
    }

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
  bindAskSelectionEvent,
  // 全局拖动状态查询（由 bindAiSidebarResize 设置）
  _sidebarResizingGetter: null
};
