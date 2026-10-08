import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import AgentRunStatus from '../AgentRunStatus';

describe('AgentRunStatus', () => {
  it('renders structured runtime status without raw tool details', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <AgentRunStatus status={{
        round: 2,
        maxRounds: 5,
        elapsedMs: 1200,
        toolCount: 3,
        currentTool: 'wiki_search',
        retryCount: 1,
        lastError: 'temporary failure',
        loopDetected: false,
        phase: 'executing_tools',
      }} />,
    ));

    expect(container.textContent).toContain('Agent 执行工具');
    expect(container.textContent).toContain('第 2/5 轮');
    expect(container.textContent).toContain('工具 3 次');
    expect(container.textContent).toContain('wiki_search');
    expect(container.textContent).not.toContain('temporary failure');

    await act(async () => root.unmount());
    container.remove();
  });
});
