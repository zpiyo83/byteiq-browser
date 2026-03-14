/**
 * AI 对话/Agent IPC 处理器
 */

function registerAiIpc(options) {
  const {
    ipcMain,
    store,
    sendStreamingChatRequest,
    sendChatRequest
  } = options;

  const activeChatRequests = new Map(); // taskId -> ClientRequest

  ipcMain.handle('ai-chat', async (event, { messages, taskId }) => {
    const resolvedTaskId = taskId || `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      const endpoint = store.get('settings.aiEndpoint', '');
      const apiKey = store.get('settings.aiApiKey', '');
      const requestType = store.get('settings.aiRequestType', 'openai-chat');
      const model = store.get('settings.aiModelId', 'gpt-3.5-turbo');
      const timeout = (store.get('settings.translationTimeout', 120) || 120) * 1000;

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
        (chunk, accumulated) => {
          event.sender.send('ai-chat-streaming', {
            taskId: resolvedTaskId,
            chunk,
            accumulated
          });
        },
        req => {
          activeChatRequests.set(resolvedTaskId, req);
        }
      );

      activeChatRequests.delete(resolvedTaskId);

      return {
        success: true,
        content: fullContent,
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

  ipcMain.handle('ai-agent', async (event, { messages, tools }) => {
    try {
      const endpoint = store.get('settings.aiEndpoint', '');
      const apiKey = store.get('settings.aiApiKey', '');
      const requestType = store.get('settings.aiRequestType', 'openai-chat');
      const model = store.get('settings.aiModelId', 'gpt-3.5-turbo');
      const timeout = (store.get('settings.translationTimeout', 120) || 120) * 1000;

      if (!endpoint || !apiKey) {
        return {
          success: false,
          error: '请先在设置中配置 AI API 端点和密钥'
        };
      }

      const result = await sendChatRequest(
        messages,
        {
          endpoint,
          apiKey,
          requestType,
          model,
          timeout,
          tools
        }
      );

      let responseData;
      try {
        responseData = JSON.parse(result);
      } catch {
        return {
          success: true,
          type: 'message',
          content: result
        };
      }

      const message = responseData.choices?.[0]?.message;
      if (message?.tool_calls && message.tool_calls.length > 0) {
        const toolCalls = message.tool_calls.map(tc => ({
          id: tc.id,
          name: tc.function?.name,
          arguments: JSON.parse(tc.function?.arguments || '{}')
        }));

        return {
          success: true,
          type: 'tool_calls',
          toolCalls
        };
      }

      return {
        success: true,
        type: 'message',
        content: message?.content || result
      };
    } catch (error) {
      console.error('AI agent error:', error);
      return {
        success: false,
        error: error.message || 'Agent请求失败'
      };
    }
  });
}

module.exports = {
  registerAiIpc
};
