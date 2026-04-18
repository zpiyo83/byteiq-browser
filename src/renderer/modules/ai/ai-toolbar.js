/**
 * AI工具栏管理 - 处理模式选择、模型选择、文件上传等功能
 */

function createAiToolbar(options) {
  const { documentRef, getCurrentMode, setCurrentMode, showToast, store } = options;

  const currentMode = 'ask';

  // 获取UI元素
  const modeBtn = documentRef.getElementById('ai-mode-btn');
  const modeLabel = documentRef.getElementById('ai-mode-label');
  const modeMenu = documentRef.getElementById('ai-mode-menu');

  const modelBtn = documentRef.getElementById('ai-model-btn');
  const modelMenu = documentRef.getElementById('ai-model-menu');
  const modelList = documentRef.getElementById('ai-model-list');

  const uploadBtn = documentRef.getElementById('ai-upload-btn');
  const fileInput = documentRef.getElementById('ai-file-input');

  let currentModel = store?.get('settings.aiModel') || 'default';

  /**
   * 初始化模式选择
   */
  function initModeSelector() {
    if (!modeBtn || !modeMenu) return;

    // 模式按钮点击
    modeBtn.addEventListener('click', e => {
      e.stopPropagation();
      // 关闭其他菜单
      closeAllMenus();
      toggleMenu(modeMenu);
    });

    // 模式菜单项点击
    const modeItems = modeMenu.querySelectorAll('.ai-menu-item');
    modeItems.forEach(item => {
      item.addEventListener('click', e => {
        e.stopPropagation();
        const mode = item.dataset.mode;
        switchMode(mode);
        closeAllMenus();
      });
    });

    updateModeButton();
  }

  /**
   * 初始化模型选择
   */
  function initModelSelector() {
    if (!modelBtn || !modelMenu) return;

    // 模型按钮点击
    modelBtn.addEventListener('click', e => {
      e.stopPropagation();
      // 关闭其他菜单
      closeAllMenus();
      loadModelList();
      toggleMenu(modelMenu);
    });

    // 设置按钮
    const settingsBtn = modelMenu.querySelector('.ai-menu-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', e => {
        e.stopPropagation();
        openModelSettings();
      });
    }
  }

  /**
   * 初始化文件上传
   */
  function initFileUpload() {
    if (!uploadBtn || !fileInput) return;

    uploadBtn.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      // TODO: 实现文件上传逻辑
      console.warn('[ai-toolbar] 选中文件:', files);
      if (showToast) {
        showToast(`已选择 ${files.length} 个文件`, 'info');
      }

      // 清空输入
      fileInput.value = '';
    });
  }

  /**
   * 切换菜单显示
   */
  function toggleMenu(menu) {
    if (!menu) return;
    const isVisible = menu.style.display !== 'none';
    menu.style.display = isVisible ? 'none' : 'block';
  }

  /**
   * 关闭所有菜单
   */
  function closeAllMenus() {
    if (modeMenu) modeMenu.style.display = 'none';
    if (modelMenu) modelMenu.style.display = 'none';
  }

  /**
   * 切换模式
   */
  function switchMode(mode) {
    if (!['ask', 'agent'].includes(mode)) return;

    if (typeof setCurrentMode === 'function') {
      setCurrentMode(mode);
    }

    updateModeButton();

    if (showToast) {
      const modeText = mode === 'ask' ? '普通对话' : '自动执行';
      showToast(`已切换为 ${modeText} 模式`, 'info');
    }
  }

  /**
   * 更新模式按钮显示
   */
  function updateModeButton() {
    if (!modeLabel) return;
    const mode = typeof getCurrentMode === 'function' ? getCurrentMode() : currentMode;
    modeLabel.textContent = mode === 'ask' ? 'Ask' : 'Agent';
  }

  /**
   * 加载模型列表
   */
  function loadModelList() {
    if (!modelList || !store) return;

    modelList.innerHTML = '';

    // 从store获取模型列表
    const models = store.get('settings.aiModelList') || [
      { id: 'gpt-4', name: 'GPT-4' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      { id: 'default', name: '默认模型' }
    ];

    models.forEach(model => {
      const btn = documentRef.createElement('button');
      btn.className = 'ai-model-item';
      btn.textContent = model.name;

      if (model.id === currentModel) {
        btn.classList.add('active');
      }

      btn.addEventListener('click', e => {
        e.stopPropagation();
        selectModel(model.id);
        closeAllMenus();
      });

      modelList.appendChild(btn);
    });
  }

  /**
   * 选择模型
   */
  function selectModel(modelId) {
    currentModel = modelId;
    if (store) {
      store.set('settings.aiModel', modelId);
    }

    if (showToast) {
      showToast(`已选择模型: ${modelId}`, 'info');
    }

    loadModelList();
  }

  /**
   * 打开模型设置
   */
  function openModelSettings() {
    // TODO: 打开模型设置对话框或面板
    console.warn('[ai-toolbar] 打开模型设置');
    if (showToast) {
      showToast('打开模型设置 (功能开发中)', 'info');
    }
  }

  /**
   * 绑定全局点击事件来关闭菜单
   */
  function bindGlobalEvents() {
    documentRef.addEventListener('click', e => {
      // 检查点击是否在菜单或按钮内
      const isClickInMenu = modeMenu && modeMenu.contains(e.target);
      const isClickInBtn = modeBtn && modeBtn.contains(e.target);
      const isClickInModelMenu = modelMenu && modelMenu.contains(e.target);
      const isClickInModelBtn = modelBtn && modelBtn.contains(e.target);

      if (!isClickInMenu && !isClickInBtn && !isClickInModelMenu && !isClickInModelBtn) {
        closeAllMenus();
      }
    });
  }

  /**
   * 初始化所有功能
   */
  function init() {
    initModeSelector();
    initModelSelector();
    initFileUpload();
    bindGlobalEvents();
  }

  return {
    init,
    switchMode,
    selectModel,
    getCurrentMode: () => currentModel
  };
}

module.exports = {
  createAiToolbar
};
