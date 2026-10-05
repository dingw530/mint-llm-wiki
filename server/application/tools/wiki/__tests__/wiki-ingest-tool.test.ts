import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ──

let mockWikiPath: string | null = '/tmp/test-wiki';
let mockApiUrl = 'https://api.example.com';

vi.mock('../../../../infrastructure/filesystem/path-security.js', () => ({
  getWikiPath: () => mockWikiPath,
}));

vi.mock('../../../../application/settings/settings-service.js', () => ({
  getAiSettings: () => ({
    apiUrl: mockApiUrl,
    apiKey: 'sk-test',
    wikiPath: mockWikiPath,
  }),
}));

vi.mock('../../../../application/wiki/wiki-ingestion-job-service.js', () => ({
  wikiIngestionJobService: {
    startChat: vi.fn((input: any) => ({
      jobId: 'job-123',
      status: 'queued' as const,
      executionMode: 'async' as const,
      fileCount: (input.source ? 1 : 0) + (input.urls?.length || 0) + (input.files?.length || 0),
      message: 'Wiki 摄入任务已加入队列',
    })),
  },
}));

import { WikiIngestTool } from '../wiki-ingest-tool.js';

const ctx = { conversationId: 'test-conv' };

describe('WikiIngestTool', () => {
  const tool = new WikiIngestTool();

  beforeEach(() => {
    vi.clearAllMocks();
    mockWikiPath = '/tmp/test-wiki';
    mockApiUrl = 'https://api.example.com';
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('wiki_ingest');
    expect(tool.isReadOnly()).toBe(false);
    expect(tool.isIdempotent()).toBe(false);
    expect(tool.executionMode).toBe('async');
    expect(tool.executionTimeoutMs).toBe(120000);
  });

  it('should ingest source text', async () => {
    const result = await tool.execute({ source: '# Hello\nWorld' }, ctx);
    expect(result.jobId).toBe('job-123');
    expect(result.status).toBe('queued');
    expect(result.executionMode).toBe('async');
    expect(result.fileCount).toBe(1);
  });

  it('should ingest URLs', async () => {
    const result = await tool.execute({ urls: ['https://example.com/doc'] }, ctx);
    expect(result.fileCount).toBe(1);
  });

  it('should ingest files', async () => {
    const encoded = Buffer.from('hello world').toString('base64');
    const result = await tool.execute({ files: [{ name: 'test.md', content: encoded }] }, ctx);
    expect(result.fileCount).toBe(1);
  });

  it('should combine multiple source types', async () => {
    const encoded = Buffer.from('hello').toString('base64');
    const result = await tool.execute(
      {
        source: '# Test',
        urls: ['https://example.com/a', 'https://example.com/b'],
        files: [
          { name: 'a.md', content: encoded },
          { name: 'b.md', content: encoded },
        ],
      },
      ctx,
    );
    expect(result.fileCount).toBe(5); // 1 source + 2 urls + 2 files
  });

  it('should throw when wiki path not configured', async () => {
    mockWikiPath = null;
    await expect(tool.execute({ source: '# Test' }, ctx)).rejects.toThrow('Wiki 路径未配置');
  });

  it('should throw when AI API not configured', async () => {
    mockApiUrl = '';
    await expect(tool.execute({ source: '# Test' }, ctx)).rejects.toThrow('AI API 未配置');
  });

  it('should throw when no input provided', async () => {
    await expect(tool.execute({}, ctx)).rejects.toThrow('请提供 source');
  });

  it('should getCallSummary for source text', () => {
    expect(tool.getCallSummary({ source: '# Hello' })).toContain('资料');
  });

  it('should getCallSummary for URLs', () => {
    expect(tool.getCallSummary({ urls: ['https://a.com'] })).toContain('1 个网页');
  });

  it('should getCallSummary for files', () => {
    expect(tool.getCallSummary({ files: [{ name: 'a.md', content: 'x' }] })).toContain('1 个文件');
  });

  it('should getCallSummary for combined inputs', () => {
    const summary = tool.getCallSummary({
      source: 'hello',
      urls: ['https://a.com', 'https://b.com'],
      files: [{ name: 'a.md', content: 'x' }],
    });
    expect(summary).toContain('资料');
    expect(summary).toContain('2 个网页');
    expect(summary).toContain('1 个文件');
  });

  it('should getResultSummary', () => {
    const summary = tool.getResultSummary({
      jobId: 'j-1',
      status: 'queued',
      executionMode: 'async',
      fileCount: 3,
      message: 'Wiki 摄入任务已加入队列',
    });
    expect(summary).toContain('3 个输入');
  });

  it('should validate input schema', () => {
    expect(tool.validate({ source: 'test' }).valid).toBe(true);
    expect(tool.validate({}).valid).toBe(true); // all fields optional in schema; runtime throws separately
  });

  it('should reject invalid URLs', () => {
    expect(tool.validate({ urls: ['ftp://bad.com'] }).valid).toBe(false);
  });
});
