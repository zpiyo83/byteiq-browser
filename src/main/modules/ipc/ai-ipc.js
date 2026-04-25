/**
 * AI 对话/Agent IPC 处理器
 */

function registerAiIpc(options) {
  const {
    ipcMain,
    store,
    sendStreamingChatRequest,
    sendChatRequest,
    sendResponsesStreamForAgent,
    sendChatCompletionsStreamForAgent,
    fetchAiModels
  } = options;

  const activeChatRequests = new Map(); // taskId -> ClientRequest
  const activeAgentRequests = new Map(); // taskId -> ClientRequest

  ipcMain.handle('ai-chat', async (event, { messages, taskId }) => {
    const resolvedTaskId = taskId || `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      const endpoint = store.get('settings.aiEndpoint', '');
      const apiKey = store.get('settings.aiApiKey', '');
      const requestType = store.get('settings.aiRequestType', 'openai-chat');
      const model = store.get('settings.aiModelId', 'gpt-3.5-turbo');
      const timeout = (store.get('settings.aiTimeout', 120) || 120) * 1000;

      if (!endpoint || !apiKey) {
        return {
          success: false,
          error: '请先在设置中配置 AI API 端点和密钥'
        };
      }

      const fullContent = await sendStreamingChatRequest(
        messages,
        {
          endpoint,
          apiKey,
          requestType,
          model,
          timeout
        },
        (chunk, accumulated, reasoningContent) => {
          if (event.sender.isDestroyed()) return;
          try {
            event.sender.send('ai-chat-streaming', {
              taskId: resolvedTaskId,
              chunk,
              accumulated,
              reasoningContent
            });
          } catch (err) {
            console.warn('[ai-ipc] Failed to send chat streaming chunk:', err.message);
          }
        },
        req => {
          activeChatRequests.set(resolvedTaskId, req);
        }
      );

      activeChatRequests.delete(resolvedTaskId);

      return {
        success: true,
        content: fullContent.content || fullContent,
        reasoningContent: fullContent.reasoningContent || '',
        taskId: resolvedTaskId
      };
    } catch (error) {
      if (error && error.message === 'Cancelled') {
        activeChatRequests.delete(resolvedTaskId);
        return {
          success: false,
          cancelled: true,
          taskId: resolvedTaskId
        };
      }

      console.error('AI chat error:', error);
      activeChatRequests.delete(resolvedTaskId);
      return {
        success: false,
        error: error.message || '对话请求失败'
      };
    }
  });

  ipcMain.on('cancel-ai-chat', (_event, { taskId }) => {
    if (!taskId) return;
    const req = activeChatRequests.get(taskId);
    if (!req) return;
    activeChatRequests.delete(taskId);
    try {
      if (req && typeof req.destroy === 'function') {
        req.destroy(new Error('Cancelled'));
      }
    } catch (error) {
      console.error('Cancel AI chat failed:', error);
    }
  });

  ipcMain.handle('ai-agent', async (event, { messages, tools, taskId }) => {
    const resolvedTaskId = taskId || `agent-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      // 注册到活跃请求 Map，以便支持取消
      let resolveAgentRequest = null;
      const agentPromise = new Promise(resolve => {
        resolveAgentRequest = resolve;
      });
      activeAgentRequests.set(resolvedTaskId, {
        promise: agentPromise,
        resolve: resolveAgentRequest
      });
      const endpoint = store.get('settings.aiEndpoint', '');
      const apiKey = store.get('settings.aiApiKey', '');
      const requestType = store.get('settings.aiRequestType', 'openai-chat');
      const model = store.get('settings.aiModelId', 'gpt-3.5-turbo');
      const timeout = (store.get('settings.aiTimeout', 120) || 120) * 1000;

      if (!endpoint || !apiKey) {
        return {
          success: false,
          error: '请先在设置中配置 AI API 端点和密钥'
        };
      }

      // 流式回调：向渲染进程发送增量文本
      const onTextChunk = (accumulated, reasoningContent) => {
        // 检查 webContents 是否已销毁，避免向已关闭的窗口发送 IPC 消息
        if (event.sender.isDestroyed()) return;
        try {
          event.sender.send('ai-agent-streaming', {
            taskId: resolvedTaskId,
            accumulated,
            reasoningContent
          });
        } catch (err) {
          console.warn(
            '[ai-ipc] Failed to send streaming chunk, webContents may be destroyed:',
            err.message
          );
        }
      };

      // 尝试带 tools 参数发送请求；如果模型 chat template 不支持 tools，自动降级重试
      const isTemplateError = err =>
        err &&
        err.message &&
        (err.message.includes('Failed to apply prompt template') ||
          err.message.includes('object is not callable') ||
          err.message.includes('tool_call') ||
          err.message.includes('tool_use'));

      let result;
      let usedToolsFallback = false;
      try {
        if (requestType === 'openai-response' && sendResponsesStreamForAgent) {
          result = await sendResponsesStreamForAgent(
            messages,
            { endpoint, apiKey, model, timeout, tools },
            onTextChunk
          );
        } else if (requestType === 'openai-chat' && sendChatCompletionsStreamForAgent) {
          result = await sendChatCompletionsStreamForAgent(
            messages,
            { endpoint, apiKey, model, timeout, tools },
            onTextChunk
          );
        } else {
          // Anthropic 或其他类型：降级为非流式
          result = await sendChatRequest(messages, {
            endpoint,
            apiKey,
            requestType,
            model,
            timeout,
            tools
          });
        }
      } catch (primaryError) {
        // 如果是 chat template 不兼容错误，尝试不带 tools 重试
        if (tools && tools.length > 0 && isTemplateError(primaryError)) {
          console.warn(
            '[ai-ipc] Chat template error with tools, retrying without tools API parameter:',
            primaryError.message
          );
          if (requestType === 'openai-response' && sendResponsesStreamForAgent) {
            result = await sendResponsesStreamForAgent(
              messages,
              { endpoint, apiKey, model, timeout, tools: null },
              onTextChunk
            );
          } else if (requestType === 'openai-chat' && sendChatCompletionsStreamForAgent) {
            result = await sendChatCompletionsStreamForAgent(
              messages,
              { endpoint, apiKey, model, timeout, tools: null },
              onTextChunk
            );
          } else {
            result = await sendChatRequest(messages, {
              endpoint,
              apiKey,
              requestType,
              model,
              timeout,
              tools: null
            });
          }
          usedToolsFallback = true;
        } else {
          throw primaryError;
        }
      }

      let responseData;
      try {
        responseData = JSON.parse(result);
      } catch {
        return {
          success: true,
          type: 'message',
          content: result,
          taskId: resolvedTaskId
        };
      }

      const message = responseData.choices?.[0]?.message;
      const reasoningContent =
        message?.reasoning_content ||
        message?.thinking ||
        message?.reasoning ||
        message?.analysis ||
        '';

      if (message?.tool_calls && message.tool_calls.length > 0) {
        const toolCalls = message.tool_calls.map(tc => ({
          id: tc.id,
          name: tc.function?.name,
          arguments: JSON.parse(tc.function?.arguments || '{}')
        }));

        return {
          success: true,
          type: 'tool_calls',
          toolCalls,
          reasoningContent,
          content: message?.content || '',
          taskId: resolvedTaskId
        };
      }

      return {
        success: true,
        type: 'message',
        content: message?.content || result,
        reasoningContent,
        usedToolsFallback,
        taskId: resolvedTaskId
      };
    } catch (error) {
      if (error && error.message === 'Cancelled') {
        activeAgentRequests.delete(resolvedTaskId);
        return {
          success: false,
          cancelled: true,
          taskId: resolvedTaskId
        };
      }
      console.error('AI agent error:', error);
      return {
        success: false,
        error: error.message || 'Agent请求失败',
        taskId: resolvedTaskId
      };
    } finally {
      activeAgentRequests.delete(resolvedTaskId);
    }
  });

  // 取消 Agent 请求
  ipcMain.on('cancel-ai-agent', (_event, { taskId }) => {
    if (!taskId) return;
    const req = activeAgentRequests.get(taskId);
    if (!req) return;
    activeAgentRequests.delete(taskId);
    try {
      if (req && typeof req.destroy === 'function') {
        req.destroy(new Error('Cancelled'));
      }
    } catch (error) {
      console.error('Cancel AI agent failed:', error);
    }
  });

  ipcMain.handle('ai-list-models', async (_event, payload = {}) => {
    try {
      const endpoint = payload.endpoint || store.get('settings.aiEndpoint', '');
      const apiKey = payload.apiKey || store.get('settings.aiApiKey', '');
      const requestType = payload.requestType || store.get('settings.aiRequestType', 'openai-chat');
      const timeout = (store.get('settings.aiTimeout', 120) || 120) * 1000;

      if (!endpoint || !apiKey) {
        return {
          success: false,
          error: '请先在设置中配置 AI API 端点和密钥'
        };
      }

      if (typeof fetchAiModels !== 'function') {
        return {
          success: false,
          error: '模型列表功能未初始化'
        };
      }

      const models = await fetchAiModels({
        endpoint,
        apiKey,
        requestType,
        timeout
      });

      return {
        success: true,
        models
      };
    } catch (error) {
      console.error('AI list models error:', error);
      return {
        success: false,
        error: error.message || '获取模型列表失败'
      };
    }
  });
}

module.exports = {
  registerAiIpc
};
