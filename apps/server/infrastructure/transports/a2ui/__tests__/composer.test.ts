import { describe, expect, it, vi } from 'vitest';
import { A2UIComposer } from '../composer.js';

vi.mock('../../../../repositories/a2uiRepository.js', () => ({
  findComponentRegistration: vi.fn(() => ({
    kind: 'wiki_source_reference',
    catalogId: 'mint',
    componentName: 'SourceReferenceCard',
    dataSchemaVersion: 1,
    dataSchema: {},
    enabled: true,
  })),
}));

describe('A2UIComposer', () => {
  it('binds wiki references to inline A2UI output across answer chunks', () => {
    const composer = new A2UIComposer();
    const tool = composer.handle({
      runId: 'run-1',
      round: 1,
      event: {
        kind: 'tool_result',
        toolName: 'wiki_search',
        result: JSON.stringify({
          results: [
            { file: 'pages/a.md', chunkId: 'pages/a.md#chunk:0', title: 'A', snippet: 'fact' },
          ],
        }),
      },
    });
    expect(tool.contextResult).toContain('"refId":"C1"');

    expect(
      composer.handle({
        runId: 'run-1',
        round: 1,
        event: { kind: 'answer_chunk', content: '事实 [C' },
      }).outputs,
    ).toEqual([{ kind: 'text', content: '事实 ' }]);
    const output = composer.handle({
      runId: 'run-1',
      round: 1,
      event: { kind: 'answer_chunk', content: '1]。' },
    }).outputs;
    expect(output.map((item) => item.kind)).toEqual(['text']);
    const completed = composer.handle({
      runId: 'run-1',
      round: 1,
      event: { kind: 'answer_completed', content: '' },
    }).outputs;
    expect(completed.map((item) => item.kind)).toEqual(['surface']);
    expect(composer.getBlocks()[0].textOffset).toBe(8);
    expect(composer.sanitizeContent('事实 [C1]。 [C99] [C')).toBe('事实 [C1]。');
  });

  it('normalizes observed reference variants only when they resolve to this run evidence', () => {
    const composer = new A2UIComposer();
    composer.handle({
      runId: 'run-1',
      round: 1,
      event: {
        kind: 'tool_result',
        toolName: 'wiki_search',
        result: { results: [{ file: 'pages/a.md', chunkId: 'a#0' }] },
      },
    });

    const first = composer.handle({
      runId: 'run-1',
      round: 1,
      event: { kind: 'answer_chunk', content: '第一项 [R' },
    });
    expect(first.outputs).toEqual([{ kind: 'text', content: '第一项 ' }]);
    const second = composer.handle({
      runId: 'run-1',
      round: 1,
      event: { kind: 'answer_chunk', content: '1]，第二项 [citation:1]，未知 [R9]。' },
    });
    expect(second.outputs).toEqual([{ kind: 'text', content: '[C1]，第二项 [C1]，未知 。' }]);
    composer.handle({ runId: 'run-1', round: 1, event: { kind: 'answer_completed', content: '' } });

    expect(composer.getBlocks()).toHaveLength(1);
    expect(composer.sanitizeContent('正文 [1]。\n[1] 这是有序步骤。 [citation:1] [R9] [C')).toBe(
      '正文 [C1]。\n[1] 这是有序步骤。 [C1]',
    );
  });

  it('allocates distinct reference ids for chunks from the same file', () => {
    const composer = new A2UIComposer();
    const result = composer.handle({
      runId: 'run-1',
      round: 1,
      event: {
        kind: 'tool_result',
        toolName: 'wiki_search',
        result: {
          results: [
            { file: 'pages/a.md', chunkId: 'pages/a.md#chunk:0' },
            { file: 'pages/a.md', chunkId: 'pages/a.md#chunk:1' },
          ],
        },
      },
    });

    expect(result.contextResult).toContain('"refId":"C1"');
    expect(result.contextResult).toContain('"refId":"C2"');
  });

  it('places references after the paragraph containing the marker', () => {
    const composer = new A2UIComposer();
    composer.handle({
      runId: 'run-1',
      round: 1,
      event: {
        kind: 'tool_result',
        toolName: 'wiki_search',
        result: { results: [{ file: 'a.md', chunkId: 'a#0' }] },
      },
    });
    const result = composer.handle({
      runId: 'run-1',
      round: 1,
      event: { kind: 'answer_chunk', content: '第一句 [C1] 后续内容。\n\n第二段。' },
    });
    expect(result.outputs.map((item) => item.kind)).toEqual(['text']);
    expect(composer.getBlocks()).toHaveLength(0);

    const completed = composer.handle({
      runId: 'run-1',
      round: 1,
      event: { kind: 'answer_completed', content: '' },
    });
    expect(completed.outputs.map((item) => item.kind)).toEqual(['surface']);
    expect(composer.getBlocks()[0].textOffset).toBe('第一句 [C1] 后续内容。\n\n第二段。'.length);
  });

  it('emits one source card when multiple chunks belong to the same file', () => {
    const composer = new A2UIComposer();
    composer.handle({
      runId: 'run-1',
      round: 1,
      event: {
        kind: 'tool_result',
        toolName: 'wiki_search',
        result: {
          results: [
            { file: 'pages/a.md', chunkId: 'pages/a.md#chunk:0', title: 'A' },
            { file: 'pages/a.md', chunkId: 'pages/a.md#chunk:1', title: 'A' },
          ],
        },
      },
    });

    composer.handle({
      runId: 'run-1',
      round: 1,
      event: { kind: 'answer_chunk', content: '结论 [C1]。补充 [C2]。' },
    });
    const completed = composer.handle({
      runId: 'run-1',
      round: 1,
      event: { kind: 'answer_completed', content: '' },
    });

    expect(completed.outputs).toHaveLength(1);
    expect(completed.outputs[0].kind).toBe('surface');
    expect(composer.getBlocks()).toHaveLength(1);
    expect(composer.getBlocks()[0].data.refId).toBe('C1');
  });

  it('renumbers references by first appearance in the answer', () => {
    const composer = new A2UIComposer();
    composer.handle({
      runId: 'run-1',
      round: 1,
      event: {
        kind: 'tool_result',
        toolName: 'wiki_search',
        result: {
          results: [
            { file: 'a.md', chunkId: 'a#0', title: 'A' },
            { file: 'b.md', chunkId: 'b#0', title: 'B' },
            { file: 'c.md', chunkId: 'c#0', title: 'C' },
          ],
        },
      },
    });

    const answer = composer.handle({
      runId: 'run-1',
      round: 1,
      event: { kind: 'answer_chunk', content: '先说 C。[C3] 再说 A。[C1]' },
    });
    expect(answer.outputs).toEqual([{ kind: 'text', content: '先说 C。[C1] 再说 A。[C2]' }]);

    composer.handle({ runId: 'run-1', round: 1, event: { kind: 'answer_completed', content: '' } });

    expect(composer.getBlocks().map((block) => block.data.refId)).toEqual(['C1', 'C2']);
    expect(composer.getBlocks().map((block) => block.data.file)).toEqual(['c.md', 'a.md']);
    expect(composer.sanitizeContent('先说 C。[C3] 再说 A。[C1]')).toBe('先说 C。[C1] 再说 A。[C2]');
    expect(composer.getDisplayReferences().map(({ file, refId }) => ({ file, refId }))).toEqual([
      { file: 'a.md', refId: 'C2' },
      { file: 'b.md', refId: 'C3' },
      { file: 'c.md', refId: 'C1' },
    ]);
  });

  it('allocates distinct references for multiple searches', () => {
    const composer = new A2UIComposer();
    const result = (file: string) =>
      composer.handle({
        runId: 'run-1',
        round: 1,
        event: {
          kind: 'tool_result',
          toolName: 'wiki_search',
          result: { results: [{ file, chunkId: `${file}#0` }] },
        },
      });
    expect(result('a.md').contextResult).toContain('"refId":"C1"');
    expect(result('b.md').contextResult).toContain('"refId":"C2"');
  });

  it('keeps a repeated tool result bound to the same immutable evidence', () => {
    const composer = new A2UIComposer();
    const context = { runId: 'run-1', round: 1, toolCallId: 'call-1' };
    const result = {
      results: [{ file: 'pages/a.md', chunkId: 'pages/a.md#chunk:0', content: 'fact' }],
    };

    const first = composer.handle({
      runId: context.runId,
      round: context.round,
      event: {
        kind: 'tool_result',
        toolName: 'wiki_search',
        toolCallId: context.toolCallId,
        result,
      },
    });
    const repeated = composer.captureToolResult('wiki_search', result, context);

    expect(first.contextResult).toContain('"refId":"C1"');
    expect(composer.getReferences()).toHaveLength(1);
    expect(composer.getReferences()[0]).toMatchObject({
      evidenceId: 'wiki-evidence:run-1|1|call-1|0|pages/a.md|pages/a.md#chunk:0',
      refId: 'C1',
      granularity: 'chunk',
      contentHash: expect.any(String),
    });
    expect(repeated).toBeUndefined();
  });

  it('allocates a new immutable evidence id for a later chunk from the same file', () => {
    const composer = new A2UIComposer();
    composer.handle({
      runId: 'run-1',
      round: 1,
      event: {
        kind: 'tool_result',
        toolName: 'wiki_search',
        toolCallId: 'call-1',
        result: {
          results: [{ file: 'pages/a.md', chunkId: 'pages/a.md#chunk:0', content: 'first' }],
        },
      },
    });
    const later = composer.handle({
      runId: 'run-1',
      round: 2,
      event: {
        kind: 'tool_result',
        toolName: 'wiki_search',
        toolCallId: 'call-2',
        result: {
          results: [{ file: 'pages/a.md', chunkId: 'pages/a.md#chunk:1', content: 'second' }],
        },
      },
    });

    expect(later.contextResult).toContain('"refId":"C2"');
    expect(composer.getReferences().map((reference) => reference.chunkId)).toEqual([
      'pages/a.md#chunk:0',
      'pages/a.md#chunk:1',
    ]);
  });

  it('carries hybrid evidence metadata into the persisted source block', () => {
    const composer = new A2UIComposer();
    composer.handle({
      runId: 'run-1',
      round: 1,
      event: {
        kind: 'tool_result',
        toolName: 'wiki_search',
        result: {
          results: [
            {
              file: 'pages/a.md',
              chunkId: 'a#0',
              title: 'A',
              heading: '索引设计',
              snippet: '证据片段',
              matchTypes: ['keyword', 'vector'],
              pageStatus: 'active',
              lexicalRank: 2,
              vectorRank: 1,
              distance: 0.22,
            },
          ],
        },
      },
    });
    composer.handle({
      runId: 'run-1',
      round: 1,
      event: { kind: 'answer_chunk', content: '结论 [C1]' },
    });
    composer.handle({ runId: 'run-1', round: 1, event: { kind: 'answer_completed', content: '' } });
    expect(composer.getBlocks()[0].data).toMatchObject({
      heading: '索引设计',
      matchTypes: ['keyword', 'vector'],
      vectorRank: 1,
      distance: 0.22,
    });
  });

  it('exposes references from an artifact-sized raw result without replacing model context', () => {
    const composer = new A2UIComposer();
    composer.captureToolResult('wiki_search', {
      results: [
        { file: 'pages/raw.md', chunkId: 'pages/raw.md#file', title: 'Raw page', heading: '' },
      ],
    });

    expect(composer.getReferences()).toEqual([
      {
        evidenceId: 'wiki-evidence:capture|0|unknown|0|pages/raw.md|pages/raw.md#file',
        refId: 'C1',
        file: 'pages/raw.md',
        title: 'Raw page',
        heading: '',
        chunkId: 'pages/raw.md#file',
        granularity: 'page',
        contentHash: expect.any(String),
      },
    ]);
    expect(composer.getBlocks()).toHaveLength(0);
  });

  it('keeps a searched chunk when a later path read returns the whole file', () => {
    const composer = new A2UIComposer();
    composer.captureToolResult('wiki_search', {
      results: [
        {
          file: 'pages/a.md',
          chunkId: 'pages/a.md#chunk:1',
          title: 'A',
          heading: '目标段落',
          snippet: 'chunk evidence',
        },
      ],
    });
    composer.captureToolResult('wiki_search', {
      results: [{ file: 'pages/a.md', chunkId: 'pages/a.md#file', title: 'A', snippet: '' }],
    });

    composer.handle({
      runId: 'run-1',
      round: 1,
      event: { kind: 'answer_chunk', content: '结论 [C1]' },
    });
    composer.handle({ runId: 'run-1', round: 1, event: { kind: 'answer_completed', content: '' } });

    expect(composer.getBlocks()[0].data).toMatchObject({
      chunkId: 'pages/a.md#chunk:1',
      heading: '目标段落',
      snippet: 'chunk evidence',
    });
  });
});
