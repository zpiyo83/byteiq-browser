/**
 * AI 请求日志模块
 * 记录 AI 每次请求的上下文、响应信息、工具调用等
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', '..', '..', 'logs');

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function getTimestamp() {
  return new Date().toISOString();
}

function getLogFileName() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `ai-requests-${year}-${month}-${day}.log`;
}

function formatLogEntry(entry) {
  const lines = ['='.repeat(80), `[${entry.timestamp}] [${entry.type}]`, ''];

  if (entry.requestId) {
    lines.push(`请求ID: ${entry.requestId}`);
  }

  if (entry.config) {
    lines.push('--- 配置信息 ---');
    const safeConfig = {
      endpoint: entry.config.endpoint,
      model: entry.config.model,
      requestType: entry.config.requestType,
      timeout: entry.config.timeout
    };
    lines.push(JSON.stringify(safeConfig, null, 2));
  }

  if (entry.messages) {
    lines.push('--- 请求上下文 (Messages) ---');
    lines.push(JSON.stringify(entry.messages, null, 2));
  }

  if (entry.tools) {
    lines.push('--- 可用工具 ---');
    const toolNames = entry.tools.map(t => t.function?.name || t.name || 'unknown');
    lines.push(JSON.stringify(toolNames, null, 2));
  }

  if (entry.requestBody) {
    lines.push('--- 请求体 ---');
    lines.push(JSON.stringify(entry.requestBody, null, 2));
  }

  if (entry.response) {
    lines.push('--- 响应信息 ---');
    if (typeof entry.response === 'object') {
      lines.push(JSON.stringify(entry.response, null, 2));
    } else {
      lines.push(entry.response);
    }
  }

  if (entry.toolCalls) {
    lines.push('--- 工具调用 ---');
    lines.push(JSON.stringify(entry.toolCalls, null, 2));
  }

  if (entry.error) {
    lines.push('--- 错误信息 ---');
    lines.push(`错误: ${entry.error.message || entry.error}`);
    if (entry.error.stack) {
      lines.push(`堆栈: ${entry.error.stack}`);
    }
  }

  if (entry.duration) {
    lines.push(`--- 耗时: ${entry.duration}ms ---`);
  }

  lines.push('');
  return lines.join('\n');
}

function writeLog(entry) {
  try {
    ensureLogsDir();
    const logFile = path.join(LOGS_DIR, getLogFileName());
    const logContent = formatLogEntry(entry);
    fs.appendFileSync(logFile, logContent, 'utf8');
  } catch (err) {
    console.error('写入 AI 日志失败:', err.message);
  }
}

function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function logAIRequest(type, data) {
  const entry = {
    timestamp: getTimestamp(),
    type,
    ...data
  };
  writeLog(entry);
  return data.requestId;
}

function logRequestStart(config, messages, tools) {
  const requestId = generateRequestId();
  logAIRequest('REQUEST_START', {
    requestId,
    config,
    messages,
    tools
  });
  return requestId;
}

function logRequestBody(requestId, requestBody) {
  logAIRequest('REQUEST_BODY', {
    requestId,
    requestBody
  });
}

function logResponse(requestId, response, toolCalls) {
  logAIRequest('RESPONSE', {
    requestId,
    response,
    toolCalls
  });
}

function logError(requestId, error) {
  logAIRequest('ERROR', {
    requestId,
    error: {
      message: error.message,
      stack: error.stack
    }
  });
}

function logRequestEnd(requestId, duration) {
  logAIRequest('REQUEST_END', {
    requestId,
    duration
  });
}

function logToolCall(requestId, toolName, toolArgs, toolResult) {
  logAIRequest('TOOL_CALL', {
    requestId,
    toolCalls: [
      {
        name: toolName,
        arguments: toolArgs,
        result: toolResult
      }
    ]
  });
}

module.exports = {
  generateRequestId,
  logRequestStart,
  logRequestBody,
  logResponse,
  logError,
  logRequestEnd,
  logToolCall,
  logAIRequest
};
