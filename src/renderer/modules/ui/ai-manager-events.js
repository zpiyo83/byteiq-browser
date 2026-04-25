/**
 * AI 管理器事件绑定
 * 负责所有 UI 事件监听器的注册
 */

const { buildAttachmentPrompt } = require('./ai-attachment-utils');

/**
 * 创建事件管理器
 * @param {Object} options - 所有事件处理所需的依赖
 */
function createEventManager(options) {
  const {
    toggleAiBtn,
    newSessionBtn,
    aiSidebar,
    closeAiBtn,
    aiSendBtn,
    aiInput,
    currentModeRef,
    agentRunner,
    chatHandler,
    contextMenu,
    contextCompress,
    contextClearBtn,
    documentRef,
    createSession,
    bindSessionToCurrentTab,
    switchToSession,
    showToast,
    t,
    syncWebviewMargin,
    getCurrentSession,
    renderSessionsList,
    renderSessionChat,
    extractAndSetPageContext,
    extractPageContent,
    updateContextBar,
    clearCurrentContext,
    getActiveTabId,
    setInputEnabled,
    pendingAttachmentsRef,
    bindHistoryPanelEvents,
    toolbar,
    bindAiSidebarResize,
    resizeHandle,
    bindAskSelectionEvent,
    scrollToBottom,
    buildSelectionContext,
    pageContext
  } = options;

  /**
   * 绑定所有事件
   */
  async function bindEvents() {
    toggleAiBtn.style.display = 'flex';

    if (newSessionBtn) {
      newSessionBtn.addEventListener('click', async () => {
        const session = await createSession();
        bindSessionToCurrentTab(session.id);
        await switchToSession(session.id);
        if (showToast) {
          showToast(t('ai.sessionCreated') || '已新建会话', 'info');
        }
      });
    }

    // 切换AI侧边栏
    toggleAiBtn.addEventListener('click', async () => {
      const wasCollapsed = aiSidebar.classList.contains('collapsed');
      aiSidebar.classList.toggle('collapsed');
      syncWebviewMargin();

      if (wasCollapsed) {
        const tabId = getActiveTabId();
        const webview = documentRef.getElementById(`webview-${tabId}`);
        if (webview && webview.tagName === 'WEBVIEW') {
          const session = await getCurrentSession();
          await renderSessionsList();
          await renderSessionChat(session);
          if (currentModeRef() !== 'agent') {
            await extractAndSetPageContext({
              tabId,
              webview,
              getCurrentSession,
              updateSession: options.updateSession,
              updateContextBar,
              renderSessionsList,
              extractPageContentFn: extractPageContent
            });
          }
        }
      }
    });

    // 关闭按钮
    closeAiBtn.addEventListener('click', () => {
      aiSidebar.classList.add('collapsed');
      syncWebviewMargin();
    });

    // 发送按钮（agent 模式下可切换为中断按钮）
    aiSendBtn.addEventListener('click', async () => {
      if (currentModeRef() === 'agent' && agentRunner.isProcessing()) {
        agentRunner.abort();
        setInputEnabled(true);
        return;
      }
      if (pendingAttachmentsRef().length > 0) {
        const enriched = buildAttachmentPrompt(pendingAttachmentsRef(), aiInput.value);
        aiInput.value = enriched;
        pendingAttachmentsRef(true); // clear
      }
      await chatHandler.handleAISend(aiInput, currentModeRef());
      contextMenu.updateContextPie();
    });

    // 回车发送
    aiInput.addEventListener('keypress', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        (async () => {
          if (pendingAttachmentsRef().length > 0) {
            const enriched = buildAttachmentPrompt(pendingAttachmentsRef(), aiInput.value);
            aiInput.value = enriched;
            pendingAttachmentsRef(true); // clear
          }
          await chatHandler.handleAISend(aiInput, currentModeRef());
          contextMenu.updateContextPie();
        })();
      }
    });

    // 设置流式响应监听
    chatHandler.setupStreamingListener();
    agentRunner.setupAgentStreamingListener();

    // 上下文大小设置变化时同步更新饼图
    const contextSizeInput = documentRef.getElementById('ai-context-size-input');
    if (contextSizeInput) {
      contextSizeInput.addEventListener('input', contextMenu.updateContextPie);
      contextSizeInput.addEventListener('change', contextMenu.updateContextPie);
    }

    // 清除上下文按钮
    if (contextClearBtn) {
      contextClearBtn.addEventListener('click', clearCurrentContext);
    }

    // 饼图 tooltip 显示/隐藏
    const contextPie = documentRef.getElementById('ai-context-pie');
    const contextTooltip = documentRef.getElementById('ai-context-tooltip');
    let tooltipTimer = null;
    if (contextPie && contextTooltip) {
      const showTooltip = () => {
        clearTimeout(tooltipTimer);
        contextTooltip.style.display = 'block';
      };
      const hideTooltip = () => {
        tooltipTimer = setTimeout(() => {
          contextTooltip.style.display = 'none';
        }, 150);
      };
      contextPie.addEventListener('mouseenter', showTooltip);
      contextPie.addEventListener('mouseleave', hideTooltip);
      contextTooltip.addEventListener('mouseenter', showTooltip);
      contextTooltip.addEventListener('mouseleave', hideTooltip);
    }

    // 压缩上下文按钮
    const compressBtn = documentRef.getElementById('ai-compress-context-btn');
    if (compressBtn) {
      compressBtn.addEventListener('click', e => {
        e.stopPropagation();
        contextCompress.compressContext();
      });
    }

    bindHistoryPanelEvents();

    toolbar.init();

    bindAiSidebarResize({
      documentRef,
      resizeHandle,
      aiSidebar
    });

    bindAskSelectionEvent({
      windowRef: window,
      aiSidebar,
      aiInput,
      getActiveTabId,
      documentRef,
      t,
      showToast,
      getCurrentSession,
      updateSession: options.updateSession,
      updateContextBar,
      renderSessionsList,
      renderSessionChat,
      scrollToBottom,
      buildSelectionContext
    });

    // 初始化页面状态指示器
    pageContext.initPageStatus();
  }

  return {
    bindEvents
  };
}

module.exports = {
  createEventManager
};
