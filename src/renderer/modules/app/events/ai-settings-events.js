/**
 * AI 设置事件绑定模块
 * 负责AI模型列表刷新、AI配置、翻译设置的事件绑定
 */

/**
 * 绑定AI设置相关事件
 * @param {object} deps - 依赖
 * @returns {object} AI设置辅助方法
 */
function bindAiSettingsEvents(deps) {
  const {
    aiApiKeyInput,
    aiEndpointInput,
    aiModelIdInput,
    aiModelListSelect,
    aiModelListStatus,
    aiModelRefreshBtn,
    aiRequestTypeSelect,
    ipcRenderer,
    store,
    translationApiEnabledToggle,
    translationApiKeyInput,
    translationConcurrencyCountInput,
    translationConcurrencyToggle,
    translationDynamicEnabledToggle,
    translationEndpointInput,
    translationMaxCharsInput,
    translationMaxTextsInput,
    translationModelIdInput,
    translationRequestTypeSelect,
    translationStreamingToggle,
    translationTargetLanguageSelect,
    translationTimeoutInput
  } = deps;

  const document = deps.documentRef;

  function setAiModelStatus(text, state) {
    if (!aiModelListStatus) return;
    aiModelListStatus.textContent = text || '';
    aiModelListStatus.classList.remove('loading', 'success', 'error');
    if (state) {
      aiModelListStatus.classList.add(state);
    }
  }

  function updateAiModelOptions(models) {
    if (!aiModelListSelect) return;
    aiModelListSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = models.length > 0 ? '选择模型' : '暂无模型';
    aiModelListSelect.appendChild(placeholder);

    models.forEach(modelId => {
      const option = document.createElement('option');
      option.value = modelId;
      option.textContent = modelId;
      aiModelListSelect.appendChild(option);
    });
  }

  function syncAiModelSelection() {
    if (!aiModelListSelect || !aiModelIdInput) return;
    const value = aiModelIdInput.value.trim();
    if (!value) return;
    const hasOption = Array.from(aiModelListSelect.options).some(option => {
      return option.value === value;
    });
    if (hasOption) {
      aiModelListSelect.value = value;
    }
  }

  async function refreshAiModelList() {
    if (!aiModelRefreshBtn || !aiModelListSelect) return;

    const endpoint = aiEndpointInput.value.trim();
    const apiKey = aiApiKeyInput.value.trim();
    const requestType = aiRequestTypeSelect.value;

    if (!endpoint || !apiKey) {
      setAiModelStatus('请先配置端点和密钥', 'error');
      return;
    }

    aiModelRefreshBtn.disabled = true;
    setAiModelStatus('正在获取模型列表...', 'loading');

    try {
      const result = await ipcRenderer.invoke('ai-list-models', {
        endpoint,
        apiKey,
        requestType
      });

      if (!result?.success) {
        setAiModelStatus(result?.error || '获取失败', 'error');
        updateAiModelOptions([]);
        return;
      }

      const models = Array.isArray(result.models) ? result.models : [];
      updateAiModelOptions(models);
      syncAiModelSelection();

      if (models.length > 0) {
        setAiModelStatus(`已获取 ${models.length} 个模型`, 'success');
      } else {
        setAiModelStatus('未获取到模型', 'error');
      }
    } catch (error) {
      setAiModelStatus(error.message || '获取失败', 'error');
    } finally {
      aiModelRefreshBtn.disabled = false;
    }
  }

  // AI端点配置事件
  aiEndpointInput.addEventListener('change', () => {
    store.set('settings.aiEndpoint', aiEndpointInput.value);
    if (aiModelListSelect) {
      updateAiModelOptions([]);
      setAiModelStatus('等待获取', '');
    }
  });

  aiApiKeyInput.addEventListener('change', () => {
    store.set('settings.aiApiKey', aiApiKeyInput.value);
    if (aiModelListSelect) {
      updateAiModelOptions([]);
      setAiModelStatus('等待获取', '');
    }
  });

  aiRequestTypeSelect.addEventListener('change', () => {
    store.set('settings.aiRequestType', aiRequestTypeSelect.value);
    if (aiModelListSelect) {
      updateAiModelOptions([]);
      setAiModelStatus('等待获取', '');
    }
  });

  if (aiModelIdInput) {
    aiModelIdInput.addEventListener('change', () => {
      store.set('settings.aiModelId', aiModelIdInput.value);
      syncAiModelSelection();
    });
  }

  if (aiModelListSelect) {
    aiModelListSelect.addEventListener('change', () => {
      const value = aiModelListSelect.value;
      if (!value) return;
      if (aiModelIdInput) {
        aiModelIdInput.value = value;
      }
      store.set('settings.aiModelId', value);
    });
  }

  if (aiModelRefreshBtn) {
    aiModelRefreshBtn.addEventListener('click', () => {
      refreshAiModelList();
    });
  }

  // 翻译设置事件绑定
  if (translationTargetLanguageSelect) {
    translationTargetLanguageSelect.addEventListener('change', () => {
      store.set('settings.translationTargetLanguage', translationTargetLanguageSelect.value);
    });
  }

  if (translationDynamicEnabledToggle) {
    translationDynamicEnabledToggle.addEventListener('change', () => {
      store.set('settings.translationDynamicEnabled', translationDynamicEnabledToggle.checked);
    });
  }

  if (translationApiEnabledToggle) {
    translationApiEnabledToggle.addEventListener('change', () => {
      store.set('settings.translationApiEnabled', translationApiEnabledToggle.checked);
    });
  }

  if (translationEndpointInput) {
    translationEndpointInput.addEventListener('change', () => {
      store.set('settings.translationEndpoint', translationEndpointInput.value);
    });
  }

  if (translationApiKeyInput) {
    translationApiKeyInput.addEventListener('change', () => {
      store.set('settings.translationApiKey', translationApiKeyInput.value);
    });
  }

  if (translationRequestTypeSelect) {
    translationRequestTypeSelect.addEventListener('change', () => {
      store.set('settings.translationRequestType', translationRequestTypeSelect.value);
    });
  }

  if (translationModelIdInput) {
    translationModelIdInput.addEventListener('change', () => {
      store.set('settings.translationModelId', translationModelIdInput.value);
    });
  }

  // 翻译高级选项事件绑定
  if (translationStreamingToggle) {
    translationStreamingToggle.addEventListener('change', () => {
      store.set('settings.translationStreaming', translationStreamingToggle.checked);
    });
  }

  if (translationConcurrencyToggle) {
    translationConcurrencyToggle.addEventListener('change', () => {
      store.set('settings.translationConcurrencyEnabled', translationConcurrencyToggle.checked);
    });
  }

  if (translationConcurrencyCountInput) {
    translationConcurrencyCountInput.addEventListener('change', () => {
      const value = Math.max(
        1,
        Math.min(10, parseInt(translationConcurrencyCountInput.value) || 2)
      );
      translationConcurrencyCountInput.value = value;
      store.set('settings.translationConcurrency', value);
    });
  }

  if (translationMaxTextsInput) {
    translationMaxTextsInput.addEventListener('change', () => {
      const value = Math.max(10, Math.min(1000, parseInt(translationMaxTextsInput.value) || 500));
      translationMaxTextsInput.value = value;
      store.set('settings.translationMaxTexts', value);
    });
  }

  if (translationMaxCharsInput) {
    translationMaxCharsInput.addEventListener('change', () => {
      const value = Math.max(
        1000,
        Math.min(100000, parseInt(translationMaxCharsInput.value) || 50000)
      );
      translationMaxCharsInput.value = value;
      store.set('settings.translationMaxChars', value);
    });
  }

  if (translationTimeoutInput) {
    translationTimeoutInput.addEventListener('change', () => {
      const value = Math.max(30, Math.min(300, parseInt(translationTimeoutInput.value) || 120));
      translationTimeoutInput.value = value;
      store.set('settings.translationTimeout', value);
    });
  }

  return {
    setAiModelStatus,
    updateAiModelOptions,
    syncAiModelSelection,
    refreshAiModelList
  };
}

module.exports = { bindAiSettingsEvents };
