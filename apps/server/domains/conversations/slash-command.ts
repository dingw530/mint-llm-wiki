export interface SlashCommandIntent {
  command: string;
  input: string;
}

const COMMAND_TO_TOOL: Readonly<Record<string, string>> = {
  '/wiki_ingest': 'wiki_ingest',
  '/wiki_search': 'wiki_search',
  '/wiki_read': 'wiki_read',
  '/knowledge_graph': 'knowledge_graph',
};

/** 校验来自 HTTP 或 Electron 的斜杠命令元数据。 */
export function validateSlashCommand(value: unknown): SlashCommandIntent | null {
  if (!value || typeof value !== 'object') return null;
  if (!('command' in value) || !('input' in value)) return null;
  if (typeof value.command !== 'string' || typeof value.input !== 'string') return null;
  if (!COMMAND_TO_TOOL[value.command] || !value.input.trim()) return null;
  return { command: value.command, input: value.input.trim() };
}

/** 将受控命令意图转换为 Agent 可理解的上下文，不直接执行工具。 */
export function buildSlashCommandContext(intent: SlashCommandIntent): string {
  const toolName = COMMAND_TO_TOOL[intent.command];
  return `本轮用户选择了受控 Wiki 命令 ${intent.command}，对应工具为 ${toolName}。请将用户参数“${intent.input}”作为本轮任务意图，仍通过既有 Agent 工具调用、工具策略和审批流程完成；不要依据客户端元数据直接执行工具。`;
}
