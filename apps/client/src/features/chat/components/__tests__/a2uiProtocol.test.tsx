import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { A2uiSurface } from '@a2ui/react/v0_9';
import A2uiSegment from '../A2uiSegment';
import { buildPersistedA2uiMessages, createA2uiProcessor, getSourceSnippet, parseA2uiMessage } from '../a2uiProtocol';
import { mintCatalog } from '../IngestionTaskCards';

const model = {
  jobId: 'job-1',
  title: 'notes.md',
  status: 'completed',
  statusLabel: '已完成',
  progress: 100,
  step: '完成',
  fileCount: 1,
  result: null,
};

describe('official A2UI v0.9 ingestion protocol', () => {
  it('only exposes summaries for chunk-level references', () => {
    expect(getSourceSnippet({ chunkId: 'pages/a.md#chunk:0', snippet: 'chunk evidence' })).toBe('chunk evidence');
    expect(getSourceSnippet({ chunkId: 'pages/a.md#claim:1', snippet: 'claim evidence' })).toBe('claim evidence');
    expect(getSourceSnippet({ chunkId: 'pages/a.md#file', snippet: 'document frontmatter' })).toBe('');
    expect(getSourceSnippet({ chunkId: 'pages/a.md#chunk:0', snippet: '  ' })).toBe('');
  });

  it('rebuilds a persisted wiki block as official messages', () => {
    const messages = buildPersistedA2uiMessages({
      id: 'block-1', messageId: 'message-1', blockIndex: 0, textOffset: 4,
      kind: 'wiki_source_reference', version: 1,
      data: { refId: 'C1', title: 'Architecture', file: 'pages/a.md', heading: 'Overview', snippet: 'fact', chunkId: 'pages/a.md#chunk:0' },
      createdAt: '', updatedAt: '',
    });
    expect(messages).toHaveLength(3);
    expect(messages[1]).toMatchObject({ updateComponents: { components: [{ component: 'SourceReferenceCard' }] } });
  });

  it('silently drops an unknown persisted block', () => {
    expect(buildPersistedA2uiMessages({
      id: 'block-unknown', messageId: 'message-1', blockIndex: 0, textOffset: 0,
      kind: 'unknown', version: 99, data: {}, createdAt: '', updatedAt: '',
    })).toEqual([]);
  });

  it('renders a wiki source reference through the shared Mint Catalog', async () => {
    const processor = createA2uiProcessor(mintCatalog);
    processor.processMessages([
      { version: 'v0.9', createSurface: { surfaceId: 'source-1', catalogId: 'mint' } },
      { version: 'v0.9', updateComponents: { surfaceId: 'source-1', components: [{ id: 'root', component: 'SourceReferenceCard', data: { path: '/source' } }] } },
      { version: 'v0.9', updateDataModel: { surfaceId: 'source-1', path: '/source', value: { refId: 'C1', title: 'Architecture', file: 'pages/a.md', heading: '索引设计', snippet: 'fact', chunkId: 'a#0', matchTypes: ['keyword', 'vector'] } } },
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<A2uiSurface surface={processor.model.getSurface('source-1')!} />));
    expect(container.querySelector('.source-reference-card')).not.toBeNull();
    expect(container.textContent).toContain('Architecture');
    expect(container.textContent).toContain('索引设计');
    expect(container.textContent).toContain('关键词');
    expect(container.textContent).toContain('语义');
    await act(async () => root.unmount());
    container.remove();
  });

  it('does not render the beginning of a whole-file result as a summary', async () => {
    const processor = createA2uiProcessor(mintCatalog);
    processor.processMessages([
      { version: 'v0.9', createSurface: { surfaceId: 'file-source', catalogId: 'mint' } },
      { version: 'v0.9', updateComponents: { surfaceId: 'file-source', components: [{ id: 'root', component: 'SourceReferenceCard', data: { path: '/source' } }] } },
      { version: 'v0.9', updateDataModel: { surfaceId: 'file-source', path: '/source', value: { refId: 'C1', title: 'Architecture', file: 'pages/a.md', snippet: 'document frontmatter', chunkId: 'pages/a.md#file' } } },
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<A2uiSurface surface={processor.model.getSurface('file-source')!} />));
    expect(container.querySelector('.source-reference-card')).not.toBeNull();
    expect(container.querySelector('.source-reference-card-snippet')).toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });

  it('does not render a separate source group heading', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <A2uiSegment
        segment={{
          type: 'a2ui',
          segmentId: 'segment-1',
          messages: [
            { version: 'v0.9', createSurface: { surfaceId: 'segment-source', catalogId: 'mint' } },
            { version: 'v0.9', updateComponents: { surfaceId: 'segment-source', components: [{ id: 'root', component: 'SourceReferenceCard', data: { path: '/source' } }] } },
            { version: 'v0.9', updateDataModel: { surfaceId: 'segment-source', path: '/source', value: { refId: 'C1', title: 'Architecture', file: 'pages/a.md', chunkId: 'pages/a.md#chunk:0' } } },
          ],
        }}
      />,
    ));
    expect(container.querySelector('.a2ui-source-group-label')).toBeNull();
    await act(async () => root.unmount());
    container.remove();
  });

  it('requests the matching wiki document when a source reference is clicked', async () => {
    const requests: Array<{ filePath: string }> = [];
    const handleRequest = (event: Event): void => {
      if (event instanceof CustomEvent && event.detail && typeof event.detail.filePath === 'string') {
        requests.push({ filePath: event.detail.filePath });
      }
    };
    window.addEventListener('mint:open-wiki-page', handleRequest);

    const processor = createA2uiProcessor(mintCatalog);
    processor.processMessages([
      { version: 'v0.9', createSurface: { surfaceId: 'source-2', catalogId: 'mint' } },
      { version: 'v0.9', updateComponents: { surfaceId: 'source-2', components: [{ id: 'root', component: 'SourceReferenceCard', data: { path: '/source' } }] } },
      { version: 'v0.9', updateDataModel: { surfaceId: 'source-2', path: '/source', value: { refId: 'C2', title: '目标文档', file: 'pages/target.md', heading: '', snippet: 'fact', chunkId: 'target#0' } } },
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<A2uiSurface surface={processor.model.getSurface('source-2')!} />));

    const card = container.querySelector<HTMLButtonElement>('.source-reference-card');
    expect(card).not.toBeNull();
    await act(async () => card?.click());
    expect(requests).toEqual([{ filePath: 'pages/target.md' }]);

    await act(async () => root.unmount());
    container.remove();
    window.removeEventListener('mint:open-wiki-page', handleRequest);
  });

  it('rejects the old flat custom envelope and accepts official messages', () => {
    expect(parseA2uiMessage(JSON.stringify({ type: 'createSurface', surfaceId: 'surface-1', catalogId: 'mint' }))).toBeNull();
    expect(parseA2uiMessage(JSON.stringify({
      version: 'v0.9',
      createSurface: { surfaceId: 'surface-1', catalogId: 'mint' },
    }))).not.toBeNull();
  });

  it('uses MessageProcessor to create, update, bind and delete a surface', () => {
    const processor = createA2uiProcessor(mintCatalog);
    processor.processMessages([
      { version: 'v0.9', createSurface: { surfaceId: 'surface-1', catalogId: 'mint' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'surface-1',
          components: [{ id: 'root', component: 'IngestionTaskCard', data: { path: '/job' } }],
        },
      },
      { version: 'v0.9', updateDataModel: { surfaceId: 'surface-1', path: '/job', value: model } },
    ]);

    const surface = processor.model.getSurface('surface-1');
    expect(surface).toBeDefined();
    expect(surface?.catalog.id).toBe('mint');
    expect(surface?.componentsModel.get('root')?.type).toBe('IngestionTaskCard');
    expect(surface?.dataModel.get('/job')).toEqual(model);

    processor.processMessages([{ version: 'v0.9', deleteSurface: { surfaceId: 'surface-1' } }]);
    expect(processor.model.getSurface('surface-1')).toBeUndefined();
  });

  it('renders the Catalog component through the official React surface renderer', async () => {
    const processor = createA2uiProcessor(mintCatalog);
    processor.processMessages([
      { version: 'v0.9', createSurface: { surfaceId: 'surface-1', catalogId: 'mint' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'surface-1',
          components: [{ id: 'root', component: 'IngestionTaskCard', data: { path: '/job' } }],
        },
      },
      { version: 'v0.9', updateDataModel: { surfaceId: 'surface-1', path: '/job', value: model } },
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<A2uiSurface surface={processor.model.getSurface('surface-1')!} />));
    expect(container.querySelector('.ingestion-task-card')).not.toBeNull();
    expect(container.textContent).toContain('notes.md');
    await act(async () => root.unmount());
    container.remove();
  });

  it('does not crash while a surface is waiting for its data model', async () => {
    const processor = createA2uiProcessor(mintCatalog);
    processor.processMessages([
      { version: 'v0.9', createSurface: { surfaceId: 'surface-1', catalogId: 'mint' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'surface-1',
          components: [{ id: 'root', component: 'IngestionTaskCard', data: { path: '/job' } }],
        },
      },
    ]);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(<A2uiSurface surface={processor.model.getSurface('surface-1')!} />));
    expect(container.querySelector('.ingestion-task-card')).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it('does not create a surface for an unknown catalog', () => {
    const processor = createA2uiProcessor(mintCatalog);
    expect(() => processor.processMessages([{ version: 'v0.9', createSurface: { surfaceId: 'surface-1', catalogId: 'unknown' } }])).toThrow('Catalog not found');
    expect(processor.model.getSurface('surface-1')).toBeUndefined();
  });
});
