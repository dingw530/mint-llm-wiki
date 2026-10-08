export interface SlashCommandDefinition {
  command: string;
  label: string;
  description: string;
  toolName: 'wiki_ingest' | 'wiki_search' | 'wiki_read' | 'knowledge_graph';
  argumentHint: string;
}

export interface ParsedSlashCommand {
  definition: SlashCommandDefinition;
  command: string;
  input: string;
}

const SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  { command: '/wiki_ingest', label: '/wiki_ingest', description: '将资料整理并编译到知识库', toolName: 'wiki_ingest', argumentHint: '输入文件、URL 或资料说明' },
  { command: '/wiki_search', label: '/wiki_search', description: '搜索已有知识页面和来源', toolName: 'wiki_search', argumentHint: '输入关键词或问题' },
  { command: '/wiki_read', label: '/wiki_read', description: '读取指定知识页面', toolName: 'wiki_read', argumentHint: '输入页面路径或标题' },
  { command: '/knowledge_graph', label: '/knowledge_graph', description: '查看知识之间的关系', toolName: 'knowledge_graph', argumentHint: '输入实体或关系说明' },
];

/** 返回 Chat 输入框可用的斜杠命令定义。 */
export function getSlashCommandDefinitions(): readonly SlashCommandDefinition[] {
  return SLASH_COMMANDS;
}

/** 根据输入开头过滤命令；只有光标语义仍处于命令前缀时才显示面板。 */
export function getSlashCommandSuggestions(input: string): readonly SlashCommandDefinition[] {
  if (!/^\/[^\s]*$/.test(input)) return [];
  const query = input.toLocaleLowerCase();
  return SLASH_COMMANDS.filter((definition) => definition.command.startsWith(query));
}

/** 将已知斜杠命令拆分为白名单命令和自由文本参数。 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const match = input.trim().match(/^(\/[^\s]+)(?:\s+(.*))?$/s);
  if (!match) return null;
  const definition = SLASH_COMMANDS.find((candidate) => candidate.command === match[1]);
  if (!definition) return null;
  return { definition, command: definition.command, input: (match[2] || '').trim() };
}
