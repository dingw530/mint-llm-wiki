import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import AgentRunStatus from '../AgentRunStatus';

describe('AgentRunStatus', () => {
  it('renders structured runtime status without raw tool details', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () =>
      root.render(
        <AgentRunStatus
          status={{
            round: 2,
            maxRounds: 5,
            elapsedMs: 1200,
            toolCount: 3,
            currentTool: 'wiki_search',
            retryCount: 1,
            lastError: 'temporary failure',
            loopDetected: false,
            phase: 'executing_tools',
          }}
        />,
      ),
    );

    expect(container.textContent).toContain('Agent 执行工具');
    expect(container.textContent).toContain('第 2/5 轮');
    expect(container.textContent).toContain('工具 3 次');
    expect(container.textContent).toContain('wiki_search');
    expect(container.textContent).not.toContain('temporary failure');

    await act(async () => root.unmount());
    container.remove();
  });

  it('shows delegated agent activity and approval controls', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onToolApproval = vi.fn();

    await act(async () =>
      root.render(
        <AgentRunStatus
          status={{
            round: 1,
            maxRounds: 5,
            elapsedMs: 250,
            toolCount: 0,
            retryCount: 0,
            loopDetected: false,
            phase: 'executing_tools',
            subagents: [
              {
                childRunId: 'child-1',
                agentId: 'worker',
                status: 'awaiting_parent_action',
                approvalId: 'approval-1',
                toolName: 'write_file',
                reason: 'writes a file',
              },
            ],
          }}
          onToolApproval={onToolApproval}
        />,
      ),
    );

    expect(container.textContent).toContain('worker: 等待审批');
    expect(container.textContent).toContain('write_file');
    expect(container.textContent).toContain('writes a file');
    const approveButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '批准',
    );
    await act(async () => approveButton?.click());
    expect(onToolApproval).toHaveBeenCalledWith('approval-1', 'approve');

    await act(async () => root.unmount());
    container.remove();
  });
});
