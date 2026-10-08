import { describe, expect, it, vi } from 'vitest';
import { createWikiNavigationTool } from '../wikiNavigationTool';

describe('createWikiNavigationTool', () => {
  it('opens safe Wiki paths and ignores unsafe paths', () => {
    const navigate = vi.fn();
    const tool = createWikiNavigationTool(navigate);
    tool.openPage(' pages/知识.md ');
    tool.openPage('../secret.md');
    tool.openPage('/absolute.md');
    expect(navigate).toHaveBeenCalledWith('/wiki?path=pages%2F%E7%9F%A5%E8%AF%86.md');
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
