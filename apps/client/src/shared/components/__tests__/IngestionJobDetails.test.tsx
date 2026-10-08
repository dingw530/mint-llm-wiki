import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import IngestionJobDetails from '../IngestionJobDetails';
import type { UploadJob } from '@/services/api/wiki';

const readWiki = vi.hoisted(() => vi.fn());

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { ...actual, readWiki };
});

const job: UploadJob = {
  id: 'job-details',
  status: 'completed',
  statusLabel: '已完成',
  phase: 'success',
  isTerminal: true,
  isSuccessful: true,
  fileName: 'notes.md',
  fileSize: 100,
  progress: 100,
  step: '完成',
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:01.000Z',
  result: {
    sourceFile: 'sources/notes.md',
    format: 'markdown',
    textLength: 30,
    preview: '# Source',
    sourcePreviewKind: 'markdown',
    pages: [
      { filename: 'pages/topic/one.md', title: 'One', size: 10, summary: 'First page' },
      { filename: 'pages/topic/two.md', title: 'Two', size: 10, summary: 'Second page' },
      { filename: 'pages/topic/three.md', title: 'Three', size: 10, summary: 'Third page' },
      { filename: 'pages/topic/four.md', title: 'Four', size: 10, summary: 'Fourth page' },
    ],
  },
};

describe('IngestionJobDetails', () => {
  it('shows source preview, all pages and opens a generated page', async () => {
    readWiki.mockResolvedValue({ content: '# Source\n\nOriginal content', path: 'sources/notes.md', name: 'notes.md', size: 30 });
    const onClose = vi.fn();
    const onOpenPage = vi.fn();
    const events: CustomEvent[] = [];
    const onEvent = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('mint:ingestion-result', onEvent);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(<IngestionJobDetails job={job} onClose={onClose} onOpenPage={onOpenPage} />));
    expect(document.body.textContent).toContain('Original content');
    expect(document.body.textContent).toContain('One');
    expect(document.body.textContent).not.toContain('Four');

    await act(async () => {
      (Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('查看全部')) as HTMLButtonElement).click();
    });
    expect(document.body.textContent).toContain('Four');

    await act(async () => {
      (Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === '查看生成页面') as HTMLButtonElement).click();
    });
    expect(onOpenPage).toHaveBeenCalledWith('pages/topic/one.md');
    expect(events.map((event) => event.detail.name)).toEqual([
      'ingestion_result_detail_opened',
      'ingestion_result_page_opened',
    ]);
    await act(async () => root.unmount());
    container.remove();
    window.removeEventListener('mint:ingestion-result', onEvent);
  });

  it('renders HTML source content when switching to rendered preview', async () => {
    readWiki.mockResolvedValue({ content: '<h1>资料</h1><p>原始 HTML 内容。</p>', path: 'sources/notes.html', name: 'notes.html', size: 34 });
    const htmlJob: UploadJob = {
      ...job,
      fileName: 'notes.html',
      result: { ...job.result!, sourceFile: 'sources/notes.html', sourcePreviewKind: 'html', pages: [] },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(<IngestionJobDetails job={htmlJob} onClose={vi.fn()} onOpenPage={vi.fn()} />));
    await act(async () => {
      (Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === '渲染预览') as HTMLButtonElement).click();
    });
    expect(document.body.textContent).toContain('原始 HTML 内容。');
    await act(async () => root.unmount());
    container.remove();
  });
});
