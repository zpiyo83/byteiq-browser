/**
 * AI Agent 工具调用文本解析器
 * 从模型文本输出中解析工具调用（兼容不支持 tools API 的模型）
 */

// 已注册的工具名集合，用于文本解析时校验
const KNOWN_TOOL_NAMES = new Set([
  'get_page_info',
  'click_element',
  'input_text',
  'search_page',
  'add_todo',
  'add_todos',
  'list_todos',
  'complete_todo',
  'complete_todos',
  'remove_todo',
  'end_session'
]);

/**
 * 从模型文本输出中解析工具调用（兼容不支持 tools API 的模型）
 * 支持的格式：
 * 1. Qwen/Hermes 格式: <tool_call>\n{"name":"xxx","arguments":{...}}\n</tool_call>
 * 2. 函数调用格式: ```json\n{"name":"xxx","arguments":{...}}\n```
 * 3. 简单 JSON 行: {"name":"xxx","arguments":{...}}
 */
function parseToolCallsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const calls = [];
  let callIdCounter = 0;

  // 格式1: <tool_call>...</tool_call> (Qwen/Hermes)
  const hermesRegex = /<tool_call>\s*\n?([\s\S]*?)\n?\s*<\/tool_call>/g;
  let match;
  while ((match = hermesRegex.exec(text)) !== null) {
    const jsonStr = match[1].trim();
    const parsed = tryParseToolCallJson(jsonStr);
    if (parsed) {
      parsed.id = `parsed_${++callIdCounter}_${Date.now()}`;
      calls.push(parsed);
    }
  }
  if (calls.length > 0) return calls;

  // 格式2: ```json ... ``` 包含工具调用
  const codeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const jsonStr = match[1].trim();
    const parsed = tryParseToolCallJson(jsonStr);
    if (parsed) {
      parsed.id = `parsed_${++callIdCounter}_${Date.now()}`;
      calls.push(parsed);
    }
  }
  if (calls.length > 0) return calls;

  // 格式3: 独立 JSON 行（name + arguments）
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const parsed = tryParseToolCallJson(trimmed);
      if (parsed) {
        parsed.id = `parsed_${++callIdCounter}_${Date.now()}`;
        calls.push(parsed);
      }
    }
  }

  return calls;
}

/**
 * 尝试将 JSON 字符串解析为工具调用
 */
function tryParseToolCallJson(jsonStr) {
  try {
    const obj = JSON.parse(jsonStr);
    // 支持多种字段名
    const name = obj.name || obj.function_name || obj.tool_name || '';
    const args = obj.arguments || obj.args || obj.parameters || obj.params || {};
    if (name && KNOWN_TOOL_NAMES.has(name)) {
      return { name, arguments: typeof args === 'object' ? args : {} };
    }
  } catch {
    // 忽略解析失败
  }
  return null;
}

/**
 * 从文本内容中移除工具调用标记，只保留正文
 */
function removeToolCallTextFromContent(text) {
  if (!text) return text;
  // 移除 <tool_call>...</tool_call> 块
  let cleaned = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  // 移除包含工具调用的 ```json ... ``` 块
  cleaned = cleaned.replace(/```json\s*\n\s*\{[\s\S]*?"name"\s*:[\s\S]*?\}\s*\n```/g, '');
  // 移除独立的工具调用 JSON 行
  cleaned = cleaned
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const obj = JSON.parse(trimmed);
          if (obj.name && KNOWN_TOOL_NAMES.has(obj.name)) return false;
        } catch {
          /* 保留 */
        }
      }
      return true;
    })
    .join('\n');
  return cleaned.trim();
}

module.exports = {
  KNOWN_TOOL_NAMES,
  parseToolCallsFromText,
  tryParseToolCallJson,
  removeToolCallTextFromContent
};
