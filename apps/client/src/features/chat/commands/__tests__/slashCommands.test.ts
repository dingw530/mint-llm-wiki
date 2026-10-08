import { describe, expect, it } from 'vitest';
import { getSlashCommandDefinitions, getSlashCommandSuggestions, parseSlashCommand } from '../slashCommands';

describe('slash command registry', () => {
  it('exposes only the first four safe Wiki commands', () => {
    expect(getSlashCommandDefinitions().map((command) => command.command)).toEqual([
      '/wiki_ingest', '/wiki_search', '/wiki_read', '/knowledge_graph',
    ]);
    expect(getSlashCommandSuggestions('/wiki_')).toHaveLength(3);
  });

  it('parses a known command while preserving free-text input separately', () => {
    expect(parseSlashCommand('/wiki_search React 状态管理')).toMatchObject({
      command: '/wiki_search', input: 'React 状态管理', definition: { toolName: 'wiki_search' },
    });
  });

  it('does not map unknown commands or text after an argument to a suggestion', () => {
    expect(parseSlashCommand('/run bash')).toBeNull();
    expect(getSlashCommandSuggestions('/wiki_search React')).toEqual([]);
  });
});
