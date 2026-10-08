import { describe, expect, it, vi } from 'vitest';
import { WikiSearchTool } from '../wiki-search-tool.js';
import { ToolExecutor } from '../../../agent-runtime/tooling/tool-executor.js';
import { ToolRegistry } from '../../../agent-runtime/tooling/tool-registry.js';

describe('WikiSearchTool validation', () => {
  it.each([
    {},
    { question: 'Find a page', paths: ['pages/a.md'] },
    { question: '  ' },
    { paths: [] },
  ])('rejects invalid question/paths combinations before execution: %j', async (input) => {
    const tool = new WikiSearchTool();
    const execute = vi.spyOn(tool, 'execute');
    const registry = new ToolRegistry();
    registry.register(tool);
    const result = await new ToolExecutor(registry).execute('wiki_search', input, {
      conversationId: 'wiki-search-validation',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('question 或 paths');
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts exactly one non-empty search mode', () => {
    const tool = new WikiSearchTool();

    expect(tool.validate({ question: 'Find a page' }).valid).toBe(true);
    expect(tool.validate({ paths: ['pages/a.md'] }).valid).toBe(true);
  });
});
