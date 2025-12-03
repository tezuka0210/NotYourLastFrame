// src/lib/agentSharedState.js
/**
 * 跨文件共享的 Agent 上下文存储工具
 * 作用：在 workflowGraph.js 和 useWorkflow.ts 之间共享前一轮 Agent 结果
 */

// 私有变量：存储前一轮 Agent 上下文（外部无法直接修改）
let _prevAgentContext = {};

/**
 * 设置 Agent 上下文（供 workflowGraph.js 调用，存储前一轮结果）
 * @param {Object} context - 前一轮 Agent 链的关键上下文
 */
export function setPrevAgentContext(context) {
  // 深拷贝，避免外部修改原对象（防止引用冲突）
  _prevAgentContext = { ...context };
  console.log('Agent 上下文已存储：', _prevAgentContext);
}

/**
 * 获取 Agent 上下文（供 useWorkflow.ts 调用，读取前一轮结果）
 * @returns {Object} 前一轮 Agent 上下文（拷贝后的对象，不影响原数据）
 */
export function getPrevAgentContext() {
  return { ..._prevAgentContext };
}

/**
 * 清空 Agent 上下文（可选：比如用户重置流程时调用）
 */
export function clearPrevAgentContext() {
  _prevAgentContext = {};
  console.log('Agent 上下文已清空');
}