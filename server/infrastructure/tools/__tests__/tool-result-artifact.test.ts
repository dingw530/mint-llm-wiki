import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import {
  ARTIFACT_ACTIVE_GRACE_MS,
  ARTIFACT_HARD_TTL_MS,
  cleanupArtifacts,
  prepareArtifactWrite,
  serializeToolResultForContext,
  TOOL_RESULT_ARTIFACT_THRESHOLD,
} from '../tool-result-artifact.js';

describe('serializeToolResultForContext', () => {
  let testArtifactRoot: string;

  beforeEach(async () => {
    testArtifactRoot = join(tmpdir(), `mint-context-artifact-test-${Date.now()}`);
    process.env.AI_CHAT_CONTEXT_ARTIFACT_DIR = testArtifactRoot;
  });

  afterEach(async () => {
    delete process.env.AI_CHAT_CONTEXT_ARTIFACT_DIR;
    delete process.env.AI_CHAT_CONTEXT_ARTIFACT_MAX_BYTES;
    await rm(testArtifactRoot, { recursive: true, force: true });
  });

  it('keeps small results unchanged', async () => {
    const result = { status: 'ok', value: 'small' };
    await expect(serializeToolResultForContext(result)).resolves.toBe(JSON.stringify(result));
  });

  it('keeps explicitly inline large results unchanged', async () => {
    const source = { content: 'x'.repeat(TOOL_RESULT_ARTIFACT_THRESHOLD + 100) };
    const content = await serializeToolResultForContext(source, {
      conversationId: 'conversation/inline',
      skipArtifact: true,
    });

    expect(content).toBe(JSON.stringify(source));
    await expect(stat(testArtifactRoot)).rejects.toThrow();
  });

  it('stores large results and returns a bounded structured preview', async () => {
    const source = { records: 'x'.repeat(TOOL_RESULT_ARTIFACT_THRESHOLD + 100) };
    const content = await serializeToolResultForContext(source, {
      summary: '读取大量记录',
      conversationId: 'conversation/test',
    });
    const envelope = JSON.parse(content);
    const artifact = JSON.parse(await readFile(envelope.artifact.path, 'utf8'));

    expect(envelope.summary).toBe('读取大量记录');
    expect(envelope.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact).toEqual(source);
    expect(content.length).toBeLessThan(5_000);
  });

  it('unwraps double-encoded JSON strings before saving an artifact', async () => {
    const source = { records: 'line 1\nline 2\n'.repeat(TOOL_RESULT_ARTIFACT_THRESHOLD) };
    const doubleEncoded = JSON.stringify(source);
    const content = await serializeToolResultForContext(doubleEncoded, {
      summary: '读取转义结果',
      conversationId: 'conversation/double-encoded',
    });
    const envelope = JSON.parse(content);
    const artifact = JSON.parse(await readFile(envelope.artifact.path, 'utf8'));

    expect(artifact).toEqual(source);
  });

  it('removes expired artifacts at startup and preserves fresh and temporary files', async () => {
    const now = Date.now();
    const directory = join(testArtifactRoot, 'conversation-1');
    await mkdir(directory, { recursive: true });
    const expiredPath = join(directory, `${now - ARTIFACT_HARD_TTL_MS - 1}-expired.json`);
    const freshPath = join(directory, `${now}-fresh.json`);
    const temporaryPath = join(directory, `${now - ARTIFACT_HARD_TTL_MS - 1}-pending.json.tmp`);
    await writeFile(expiredPath, 'expired');
    await writeFile(freshPath, 'fresh');
    await writeFile(temporaryPath, 'pending');

    const report = await cleanupArtifacts({ mode: 'startup', now });

    expect(report.deletedFiles).toBe(1);
    await expect(readFile(expiredPath)).rejects.toThrow();
    await expect(readFile(freshPath, 'utf8')).resolves.toBe('fresh');
    await expect(readFile(temporaryPath, 'utf8')).resolves.toBe('pending');
  });

  it('skips cleanup before write when projected size is below the threshold', async () => {
    process.env.AI_CHAT_CONTEXT_ARTIFACT_MAX_BYTES = '1000';
    const directory = join(testArtifactRoot, 'conversation-1');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '1-existing.json'), 'x'.repeat(500));

    const report = await prepareArtifactWrite(100);

    expect(report.scannedFiles).toBe(0);
    await expect(readFile(join(directory, '1-existing.json'), 'utf8')).resolves.toHaveLength(500);
  });

  it('removes empty conversation directories without removing the artifact root', async () => {
    const emptyDirectory = join(testArtifactRoot, 'empty-conversation');
    await mkdir(emptyDirectory, { recursive: true });

    await cleanupArtifacts({ mode: 'startup' });

    await expect(stat(emptyDirectory)).rejects.toThrow();
    await expect(stat(testArtifactRoot)).resolves.toBeTruthy();
  });

  it('cleans expired and old files before a near-limit write', async () => {
    process.env.AI_CHAT_CONTEXT_ARTIFACT_MAX_BYTES = '1000';
    const now = Date.now();
    const directory = join(testArtifactRoot, 'conversation-1');
    await mkdir(directory, { recursive: true });
    const expiredPath = join(directory, `${now - ARTIFACT_HARD_TTL_MS - 1}-expired.json`);
    const oldPath = join(directory, `${now - ARTIFACT_ACTIVE_GRACE_MS - 1}-old.json`);
    await writeFile(expiredPath, 'x'.repeat(400));
    await writeFile(oldPath, 'y'.repeat(400));
    await utimes(
      oldPath,
      new Date(now - ARTIFACT_ACTIVE_GRACE_MS - 1),
      new Date(now - ARTIFACT_ACTIVE_GRACE_MS - 1),
    );

    const report = await prepareArtifactWrite(400);
    expect(report.deletedFiles).toBe(2);
    expect(report.reclaimedBytes).toBe(800);
    await expect(readFile(expiredPath)).rejects.toThrow();
    await expect(readFile(oldPath)).rejects.toThrow();
  });

  it('fails before writing when the limit is full of protected files', async () => {
    process.env.AI_CHAT_CONTEXT_ARTIFACT_MAX_BYTES = '1000';
    const directory = join(testArtifactRoot, 'conversation-1');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${Date.now()}-protected.json`), 'x'.repeat(900));

    await expect(prepareArtifactWrite(200)).rejects.toThrow('Artifact storage limit reached');
  });
});
