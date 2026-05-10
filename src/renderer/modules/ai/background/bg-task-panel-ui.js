/**
 * 后台任务面板 UI
 * 渲染任务列表、状态图标、结果查看
 */

const { renderMarkdownToElement } = require('../chat/ai-markdown-renderer');
const {
  getToolIcon,
  getToolColor,
  getStatusIcon,
  getToolTitle
} = require('../tools/ai-tool-card-constants');
const { createBadgeStyleRenderer } = require('../tools/ai-tool-style-badge');

/**
 * 创建后台任务面板 UI
 * @param {Object} options - 依赖注入
 * @returns {Object} 面板 UI 实例
 */
function createBgTaskPanelUI(options) {
  const { documentRef, taskManager, t } = options;

  let panelEl = null;
  let taskListEl = null;
  let resultOverlayEl = null;

  /**
   * 初始化面板 DOM
   */
  function init() {
    panelEl = documentRef.getElementById('bg-task-panel');
    taskListEl = documentRef.getElementById('bg-task-list');
    resultOverlayEl = documentRef.getElementById('bg-task-result-overlay');

    if (!panelEl || !taskListEl) return;

    // 关闭面板按钮
    const backBtn = documentRef.getElementById('bg-task-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        hidePanel();
      });
    }

    // 关闭结果弹窗
    if (resultOverlayEl) {
      const closeResultBtn = documentRef.getElementById('bg-task-result-close-btn');
      if (closeResultBtn) {
        closeResultBtn.addEventListener('click', () => {
          hideResultOverlay();
        });
      }
      resultOverlayEl.addEventListener('click', e => {
        if (e.target === resultOverlayEl) {
          hideResultOverlay();
        }
      });
    }
  }

  /**
   * 显示面板
   */
  function showPanel() {
    if (!panelEl) return;
    panelEl.classList.add('bg-panel-visible');
    renderTaskList();
  }

  /**
   * 隐藏面板
   */
  function hidePanel() {
    if (!panelEl) return;
    panelEl.classList.remove('bg-panel-visible');
  }

  /**
   * 切换面板显示
   */
  function togglePanel() {
    if (!panelEl) return;
    if (panelEl.classList.contains('bg-panel-visible')) {
      hidePanel();
    } else {
      showPanel();
    }
  }

  /**
   * 隐藏结果弹窗
   */
  function hideResultOverlay() {
    if (!resultOverlayEl) return;
    resultOverlayEl.classList.remove('bg-result-visible');
  }

  /**
   * 渲染任务列表
   */
  function renderTaskList() {
    if (!taskListEl) return;

    const tasks = taskManager.getTasks();
    taskListEl.innerHTML = '';

    if (tasks.length === 0) {
      const emptyEl = documentRef.createElement('div');
      emptyEl.className = 'bg-task-empty';
      emptyEl.textContent = t('ai.bgTaskEmpty') || '暂无后台任务';
      taskListEl.appendChild(emptyEl);
      return;
    }

    tasks.forEach(task => {
      const itemEl = documentRef.createElement('div');
      itemEl.className = `bg-task-item bg-task-${task.status}`;
      itemEl.dataset.taskId = task.id;

      // 状态图标
      const statusIcon = documentRef.createElement('span');
      statusIcon.className = 'bg-task-status-icon';
      if (task.status === 'running') {
        statusIcon.innerHTML =
          '<svg viewBox="0 0 24 24" width="16" height="16" class="bg-task-spinning">' +
          '<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4" stroke-linecap="round" opacity="0.25"></circle>' +
          '<path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="31.4" d="M12 2 A10 10 0 0 1 22 12"></path>' +
          '</svg>';
      } else if (task.status === 'completed') {
        statusIcon.innerHTML =
          '<svg viewBox="0 0 24 24" width="16" height="16">' +
          '<path fill="currentColor" d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/>' +
          '</svg>';
      } else {
        statusIcon.innerHTML =
          '<svg viewBox="0 0 24 24" width="16" height="16">' +
          '<path fill="currentColor" d="M13,13H11V7H13M13,17H11V15H13M12,2A10,10 0 0,0 2,12' +
          'A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/>' +
          '</svg>';
      }

      // 任务名称
      const nameEl = documentRef.createElement('span');
      nameEl.className = 'bg-task-name';
      nameEl.textContent = task.name;

      // 工具调用标签
      const toolBadgeEl = documentRef.createElement('span');
      toolBadgeEl.className = 'bg-task-tool-badge';
      if (task.latestToolCall) {
        renderToolBadgeContent(toolBadgeEl, task.latestToolCall);
      }

      // 时间 + 删除按钮容器
      const timeWrap = documentRef.createElement('span');
      timeWrap.className = 'bg-task-time-wrap';

      const timeEl = documentRef.createElement('span');
      timeEl.className = 'bg-task-time';
      timeEl.textContent = formatTime(task.createdAt);
      timeWrap.appendChild(timeEl);

      // 已完成/失败任务：添加删除按钮（hover 时显示）
      if (task.status !== 'running') {
        const deleteBtn = documentRef.createElement('button');
        deleteBtn.className = 'bg-task-delete-btn';
        deleteBtn.innerHTML =
          '<svg viewBox="0 0 24 24" width="12" height="12">' +
          '<path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>' +
          '</svg>';
        deleteBtn.addEventListener('click', e => {
          e.stopPropagation();
          taskManager.cleanupTask(task.id, documentRef);
          taskManager.removeTask(task.id);
          renderTaskList();
        });
        timeWrap.appendChild(deleteBtn);
      }

      // 取消按钮（仅运行中）
      if (task.status === 'running') {
        const cancelBtn = documentRef.createElement('button');
        cancelBtn.className = 'bg-task-cancel-btn';
        cancelBtn.textContent = t('ai.bgTaskCancel') || '取消';
        cancelBtn.addEventListener('click', e => {
          e.stopPropagation();
          taskManager.cancelTask(task.id);
          taskManager.cleanupTask(task.id, documentRef);
          renderTaskList();
        });
        itemEl.appendChild(cancelBtn);
      }

      itemEl.appendChild(statusIcon);
      itemEl.appendChild(nameEl);
      itemEl.appendChild(toolBadgeEl);
      itemEl.appendChild(timeWrap);

      // 点击查看结果（已完成/失败）
      if (task.status !== 'running') {
        itemEl.classList.add('bg-task-clickable');
        itemEl.addEventListener('click', () => {
          showTaskResult(task);
        });
      }

      taskListEl.appendChild(itemEl);
    });
  }

  /**
   * 显示任务结果
   */
  function showTaskResult(task) {
    if (!resultOverlayEl) return;

    const resultContent = documentRef.getElementById('bg-task-result-content');
    const resultTitle = documentRef.getElementById('bg-task-result-title');

    if (resultTitle) {
      resultTitle.textContent = task.name;
    }

    if (resultContent) {
      resultContent.innerHTML = '';
      if (task.result) {
        const contentDiv = documentRef.createElement('div');
        contentDiv.className = 'bg-task-result-text';
        renderMarkdownToElement(contentDiv, task.result, documentRef);
        resultContent.appendChild(contentDiv);
      } else {
        resultContent.textContent = t('ai.bgTaskNoResult') || '无结果';
      }
    }

    resultOverlayEl.classList.add('bg-result-visible');
  }

  /**
   * 格式化时间
   */
  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * 更新 header 图标状态
   */
  function updateHeaderIcon() {
    const iconBtn = documentRef.getElementById('ai-bg-task-btn');
    if (!iconBtn) return;

    const runningCount = taskManager.getRunningCount();

    if (runningCount > 0) {
      iconBtn.classList.add('has-running-tasks');
    } else {
      iconBtn.classList.remove('has-running-tasks');
    }
  }

  // 复用 badge 渲染器
  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function createDescElement(text, _toolName) {
    const el = documentRef.createElement('span');
    el.textContent = text || '';
    return el;
  }

  const { renderBadgeStyle } = createBadgeStyleRenderer({
    documentRef,
    getStatusIcon,
    getToolIcon,
    createDescElement,
    buildParamSummary: () => '',
    hexToRgba
  });

  /**
   * 渲染工具标签内容（复用 badge 渲染器）
   * @param {HTMLElement} badgeEl - 标签容器
   * @param {Object} toolCallInfo - 工具调用信息 { toolName, status, title }
   */
  function renderToolBadgeContent(badgeEl, toolCallInfo) {
    badgeEl.innerHTML = '';
    if (!toolCallInfo || !toolCallInfo.toolName) return;

    const color = getToolColor(toolCallInfo.toolName);
    const title = toolCallInfo.title || getToolTitle(toolCallInfo.toolName);
    const status = toolCallInfo.status || 'running';

    // 直接复用 badge 渲染器，描述传空
    renderBadgeStyle(badgeEl, title, '', status, toolCallInfo.toolName, color, []);
  }

  /**
   * 更新单个任务的工具标签（增量更新，避免全量重渲染）
   * @param {string} taskId - 任务 ID
   * @param {Object} toolCallInfo - 工具调用信息
   */
  function updateTaskToolBadge(taskId, toolCallInfo) {
    if (!taskListEl) return;
    const itemEl = taskListEl.querySelector(`[data-task-id="${taskId}"]`);
    if (!itemEl) return;

    let badgeEl = itemEl.querySelector('.bg-task-tool-badge');
    if (!badgeEl) {
      // 如果标签元素不存在（可能在 nameEl 和 timeEl 之间插入）
      badgeEl = documentRef.createElement('span');
      badgeEl.className = 'bg-task-tool-badge';
      const nameEl = itemEl.querySelector('.bg-task-name');
      if (nameEl && nameEl.nextSibling) {
        itemEl.insertBefore(badgeEl, nameEl.nextSibling);
      } else if (nameEl) {
        itemEl.appendChild(badgeEl);
      }
    }

    renderToolBadgeContent(badgeEl, toolCallInfo);
  }

  return {
    init,
    showPanel,
    hidePanel,
    togglePanel,
    renderTaskList,
    updateTaskToolBadge,
    updateHeaderIcon
  };
}

module.exports = {
  createBgTaskPanelUI
};
