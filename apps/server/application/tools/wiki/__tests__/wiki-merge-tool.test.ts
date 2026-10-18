import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WikiMergeTool } from '../wiki-merge-tool.js';
import { ToolExecutor } from '../../../agent-runtime/tooling/tool-executor.js';
import { ToolRegistry } from '../../../agent-runtime/tooling/tool-registry.js';

const mocks = vi.hoisted(() => ({
  getAiSettings: vi.fn(),
  getJevSettings: vi.fn(),
  getWikiPath: vi.fn(),
  mergeExistingWikiPage: vi.fn(),
}));

vi.mock('../../../../application/settings/settings-service.js', () => ({
  getAiSettings: mocks.getAiSettings,
  getJevSettings: mocks.getJevSettings,
}));
vi.mock('../../../wiki/wiki-path.js', () => ({ getWikiPath: mocks.getWikiPath }));
vi.mock('../../../../domains/wiki/index.js', () => ({
  mergeExistingWikiPage: mocks.mergeExistingWikiPage,
}));

describe('WikiMergeTool', () => {
  beforeEach(() => {
    mocks.getAiSettings
      .mockReset()
      .mockReturnValue({ apiUrl: 'https://llm.example', apiKey: 'key' });
    mocks.getJevSettings.mockReset().mockReturnValue({ wikiIdentityEnabled: true });
    mocks.getWikiPath.mockReset().mockReturnValue('/tmp/wiki');
    mocks.mergeExistingWikiPage.mockReset().mockResolvedValue({
      sourcePath: 'pages/concepts/old.md',
      targetPath: 'pages/concepts/canonical.md',
      revisionPath: 'sources/wiki-merge-revisions/revision.md',
      provider: 'jev',
      candidateCount: 1,
      message: 'merged',
    });
  });

  it('requires approval and is never automatically retried', () => {
    const tool = new WikiMergeTool();
    expect(tool.name).toBe('wiki_merge');
    expect(tool.getMetadata()).toMatchObject({ approvalMode: 'always', retrySafety: 'never' });
  });

  it('delegates an approved source path to the merge service', async () => {
    const tool = new WikiMergeTool();
    const input = { sourcePath: 'pages/concepts/old.md' };
    await expect(
      tool.execute(input, { conversationId: 'conversation-1', approvalGranted: true }),
    ).resolves.toMatchObject({ targetPath: 'pages/concepts/canonical.md' });
    expect(mocks.mergeExistingWikiPage).toHaveBeenCalledWith(
      expect.objectContaining({ apiUrl: 'https://llm.example' }),
      '/tmp/wiki',
      input.sourcePath,
      expect.objectContaining({ wikiIdentityEnabled: true }),
      expect.any(Function),
    );
  });

  it('rejects execution when approval is absent', async () => {
    const tool = new WikiMergeTool();
    await expect(
      tool.execute({ sourcePath: 'pages/concepts/old.md' }, { conversationId: 'conversation-1' }),
    ).rejects.toThrow('wiki_merge 需要用户审批');
    expect(mocks.mergeExistingWikiPage).not.toHaveBeenCalled();
  });

  it('is stopped by the runtime approval gate before any service call', async () => {
    const tool = new WikiMergeTool();
    const registry = new ToolRegistry();
    registry.register(tool);
    const requestApproval = vi.fn(() => 'approval-1');
    const result = await new ToolExecutor(registry).execute(
      'wiki_merge',
      { sourcePath: 'pages/concepts/old.md' },
      { conversationId: 'conversation-1', requestApproval },
    );

    expect(result).toMatchObject({
      success: false,
      errorCode: 'APPROVAL_REQUIRED',
      approvalRequired: { approvalId: 'approval-1' },
    });
    expect(mocks.mergeExistingWikiPage).not.toHaveBeenCalled();
  });
});
