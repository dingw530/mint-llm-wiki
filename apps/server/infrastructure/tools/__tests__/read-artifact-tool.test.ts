import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadArtifactTool } from '../read-artifact-tool.js';

describe('ReadArtifactTool', () => {
  let root = '';
  const tool = new ReadArtifactTool();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mint-read-artifact-'));
    process.env.AI_CHAT_CONTEXT_ARTIFACT_DIR = root;
  });

  afterEach(async () => {
    delete process.env.AI_CHAT_CONTEXT_ARTIFACT_DIR;
    await rm(root, { recursive: true, force: true });
  });

  it('reads a bounded slice and reports pagination metadata', async () => {
    const artifactPath = join(root, 'conversation', 'result.json');
    await mkdir(join(root, 'conversation'), { recursive: true });
    await writeFile(artifactPath, '0123456789', 'utf8');

    const result = await tool.execute(
      { path: artifactPath, offset: 2, max_chars: 4 },
      { conversationId: 'conv-1' },
    );

    expect(result.content).toBe('2345');
    expect(result.totalChars).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(tool.getResultSummary(result)).toBe('已读取 artifact 2-6/10');
  });

  it('does not render NaN when summary metadata is incomplete', () => {
    const malformedResult = { content: 'abc', totalChars: 10 };

    const summary = Reflect.apply(tool.getResultSummary, tool, [malformedResult]);

    expect(summary).toBe('已读取 artifact 0-3/10');
    expect(summary).not.toContain('NaN');
  });

  it('rejects paths outside the artifact root', async () => {
    await expect(
      tool.execute({ path: join(root, '..', 'outside.json') }, { conversationId: 'conv-1' }),
    ).rejects.toThrow('路径不安全');
  });
});
