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
          event.sender.send('ai-chat-streaming', {
            taskId: resolvedTaskId,
            chunk,
            accumulated,
            reasoningContent
          });
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
        event.sender.send('ai-agent-streaming', {
          taskId: resolvedTaskId,
          accumulated,
          reasoningContent
        });
      };

      let result;
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
        taskId: resolvedTaskId
      };
    } catch (error) {
      console.error('AI agent error:', error);
      return {
        success: false,
        error: error.message || 'Agent请求失败',
        taskId: resolvedTaskId
      };
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
