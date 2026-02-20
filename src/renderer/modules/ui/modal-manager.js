/**
 * 模态框管理器
 * 提供自定义模态框替代原生 confirm/alert
 */

const modalIcons = {
  info: '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" d="M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/></svg>',
  warning:
    '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" d="M13,14H11V10H13M13,18H11V16H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/></svg>',
  error:
    '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z"/></svg>',
  success:
    '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4M11,16.5L6.5,12L7.91,10.59L11,13.67L16.59,8.09L18,9.5L11,16.5Z"/></svg>',
  confirm:
    '<svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" d="M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z"/></svg>'
};

let modalOverlay = null;
let modalIcon = null;
let modalTitle = null;
let modalMessage = null;
let modalButtons = null;
let resolvePromise = null;

/**
 * 初始化模态框
 */
function init() {
  modalOverlay = document.getElementById('modal-overlay');
  modalIcon = document.getElementById('modal-icon');
  modalTitle = document.getElementById('modal-title');
  modalMessage = document.getElementById('modal-message');
  modalButtons = document.getElementById('modal-buttons');

  if (modalOverlay) {
    modalOverlay.addEventListener('click', e => {
      if (e.target === modalOverlay && resolvePromise) {
        resolvePromise(false);
        hide();
      }
    });

    // ESC 键关闭
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modalOverlay && modalOverlay.classList.contains('visible')) {
        if (resolvePromise) {
          resolvePromise(false);
        }
        hide();
      }
    });
  }
}

/**
 * 显示模态框
 * @param {Object} options 配置选项
 * @param {string} options.type 类型: info, warning, error, success, confirm
 * @param {string} options.title 标题
 * @param {string} options.message 消息
 * @param {Array} options.buttons 按钮配置
 * @returns {Promise<boolean|any>}
 */
function show({ type = 'info', title = '', message = '', buttons = null }) {
  return new Promise(resolve => {
    resolvePromise = resolve;

    if (!modalOverlay) {
      init();
    }

    // 设置图标
    if (modalIcon) {
      modalIcon.className = `modal-icon ${type}`;
      modalIcon.innerHTML = modalIcons[type] || modalIcons.info;
    }

    // 设置标题
    if (modalTitle) {
      modalTitle.textContent = title;
      modalTitle.style.display = title ? 'block' : 'none';
    }

    // 设置消息
    if (modalMessage) {
      modalMessage.textContent = message;
    }

    // 设置按钮
    if (modalButtons) {
      modalButtons.innerHTML = '';

      if (buttons) {
        buttons.forEach(btn => {
          const button = document.createElement('button');
          button.className = `modal-btn ${btn.class || 'modal-btn-default'}`;
          button.textContent = btn.text;
          button.addEventListener('click', () => {
            resolve(btn.value);
            hide();
          });
          modalButtons.appendChild(button);
        });
      } else {
        // 默认按钮
        const okBtn = document.createElement('button');
        okBtn.className = 'modal-btn modal-btn-primary';
        okBtn.textContent = '确定';
        okBtn.addEventListener('click', () => {
          resolve(true);
          hide();
        });
        modalButtons.appendChild(okBtn);
      }
    }

    // 显示模态框
    if (modalOverlay) {
      modalOverlay.classList.add('visible');
    }
  });
}

/**
 * 隐藏模态框
 */
function hide() {
  if (modalOverlay) {
    modalOverlay.classList.remove('visible');
  }
  resolvePromise = null;
}

/**
 * 显示确认对话框
 * @param {string} message 消息
 * @param {string} title 标题
 * @returns {Promise<boolean>}
 */
function confirm(message, title = '确认') {
  return show({
    type: 'confirm',
    title,
    message,
    buttons: [
      { text: '取消', value: false, class: 'modal-btn-default' },
      { text: '确定', value: true, class: 'modal-btn-primary' }
    ]
  });
}

/**
 * 显示删除确认对话框
 * @param {string} message 消息
 * @param {string} title 标题
 * @returns {Promise<boolean>}
 */
function confirmDelete(message, title = '确认删除') {
  return show({
    type: 'warning',
    title,
    message,
    buttons: [
      { text: '取消', value: false, class: 'modal-btn-default' },
      { text: '删除', value: true, class: 'modal-btn-danger' }
    ]
  });
}

/**
 * 显示提示对话框
 * @param {string} message 消息
 * @param {string} title 标题
 * @returns {Promise<boolean>}
 */
function alert(message, title = '提示') {
  return show({
    type: 'info',
    title,
    message
  });
}

/**
 * 显示成功提示
 * @param {string} message 消息
 * @param {string} title 标题
 */
function success(message, title = '成功') {
  return show({
    type: 'success',
    title,
    message
  });
}

/**
 * 显示错误提示
 * @param {string} message 消息
 * @param {string} title 标题
 */
function error(message, title = '错误') {
  return show({
    type: 'error',
    title,
    message
  });
}

/**
 * 显示警告提示
 * @param {string} message 消息
 * @param {string} title 标题
 */
function warning(message, title = '警告') {
  return show({
    type: 'warning',
    title,
    message
  });
}

module.exports = {
  init,
  show,
  hide,
  confirm,
  confirmDelete,
  alert,
  success,
  error,
  warning
};
