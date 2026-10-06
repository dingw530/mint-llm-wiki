import { describe, expect, it } from 'vitest';
import { buildSlashCommandContext, validateSlashCommand } from '../slash-command.js';

describe('slash command service', () => {
  it('accepts only the registered commands with non-empty input', () => {
    expect(validateSlashCommand({ command: '/wiki_search', input: 'React' })).toEqual({
      command: '/wiki_search',
      input: 'React',
    });
    expect(validateSlashCommand({ command: '/bash', input: 'ls' })).toBeNull();
    expect(validateSlashCommand({ command: '/wiki_search', input: '  ' })).toBeNull();
  });

  it('builds constrained Agent context without creating a direct execution path', () => {
    expect(buildSlashCommandContext({ command: '/wiki_read', input: 'pages/react.md' })).toContain(
      'wiki_read',
    );
    expect(buildSlashCommandContext({ command: '/wiki_read', input: 'pages/react.md' })).toContain(
      '审批流程',
    );
  });
});
