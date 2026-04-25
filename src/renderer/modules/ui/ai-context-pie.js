/**
 * AI 上下文饼图管理器
 * 负责 token 估算和上下文使用量饼图更新
 */

/**
 * 创建上下文菜单管理器
 * @param {Object} options
 * @param {Object} options.store - 配置存储
 * @param {Document} options.documentRef - 文档引用
 * @param {Object} options.agentRunner - Agent 运行器实例
 */
function createContextMenu(options) {
  const { store, documentRef, agentRunner } = options;

  // 上下文饼图元素
  const pieUsed = documentRef.getElementById('ai-pie-used');

  // 简易 token 估算：中文约 1.5 token/字，英文约 1.3 token/4字符
  function estimateTokens(text) {
    if (!text) return 0;
    const str = typeof text === 'string' ? text : JSON.stringify(text);
    let tokens = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      // CJK 字符
      if (code >= 0x4e00 && code <= 0x9fff) {
        tokens += 1.5;
      } else {
        tokens += 0.25;
      }
    }
    return Math.ceil(tokens);
  }

  // 估算消息历史的 token 用量
  function estimateHistoryTokens(messages) {
    if (!Array.isArray(messages)) return { total: 0, system: 0, history: 0 };
    let system = 0;
    let history = 0;
    for (const msg of messages) {
      const msgTokens =
        estimateTokens(msg.content) +
        estimateTokens(JSON.stringify(msg.tool_calls || msg.tool_call_id || ''));
      if (msg.role === 'system') {
        system += msgTokens;
      } else {
        history += msgTokens;
      }
    }
    return { total: system + history, system, history };
  }

  // 更新上下文饼图
  function updateContextPie() {
    if (!pieUsed) return;
    // 优先从 store 读取最新值，确保与设置同步
    let contextSize = 8192;
    if (store) {
      contextSize = store.get('settings.aiContextSize', 8192);
    }
    const messages = agentRunner.getMessageHistory();
    const { total, system, history } = estimateHistoryTokens(messages);
    const pct = Math.min(100, Math.round((total / contextSize) * 100));

    // 更新饼图 SVG
    pieUsed.setAttribute('stroke-dasharray', `${pct} ${100 - pct}`);

    // 根据使用率变色
    if (pct > 90) {
      pieUsed.setAttribute('stroke', '#ef4444');
    } else if (pct > 70) {
      pieUsed.setAttribute('stroke', '#f59e0b');
    } else {
      pieUsed.setAttribute('stroke', '#4285f4');
    }

    // 更新 tooltip
    const ttUsed = documentRef.getElementById('tt-used');
    const ttUsedK = documentRef.getElementById('tt-used-k');
    const ttTotalK = documentRef.getElementById('tt-total-k');
    const ttRemainK = documentRef
      .getElementById('ai-context-tooltip')
      ?.querySelector('.tooltip-row span:last-child'); // remainK
    const ttSystem = documentRef.getElementById('tt-system');
    const ttHistory = documentRef.getElementById('tt-history');
    if (ttUsed) ttUsed.textContent = `${pct}%`;
    if (ttUsedK) ttUsedK.textContent = `${(total / 1000).toFixed(1)}K`;
    if (ttTotalK) ttTotalK.textContent = `${(contextSize / 1000).toFixed(1)}K`;
    if (ttRemainK)
      ttRemainK.textContent = `${(Math.max(0, contextSize - total) / 1000).toFixed(1)}K`;
    if (ttSystem) ttSystem.textContent = `${system}`;
    if (ttHistory) ttHistory.textContent = `${history}`;
  }

  return {
    estimateTokens,
    estimateHistoryTokens,
    updateContextPie
  };
}

module.exports = {
  createContextMenu
};
