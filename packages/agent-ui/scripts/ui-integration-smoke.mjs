import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentTracePanel } from '../dist/index.js';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const container = document.getElementById('root');
const root = createRoot(container);
const detail = {
  eventId: 'dispatch-1',
  availability: 'available',
  historyCompleteness: 'complete',
  payload: {
    type: 'tool_dispatch_committed',
    argumentsJson: '{"content":"secret-value"}',
  },
};

await act(async () => {
  root.render(
    createElement(AgentTracePanel, {
      entries: [
        {
          id: 'tool-row-1',
          eventIds: ['dispatch-1'],
          seq: 1,
          runId: 'run-1',
          turnId: 'turn-1',
          callId: 'call-1',
          lane: 'tool',
          kind: 'tool',
          label: 'write_file',
          status: 'outcome_unknown',
          createdAt: '2026-10-21T00:00:00.000Z',
          detailEventIds: ['dispatch-1'],
          synthetic: true,
        },
      ],
      loadEvent: async () => detail,
    }),
  );
});

assert.match(container.textContent, /结果未知/);
assert.doesNotMatch(container.textContent, /secret-value/);
assert.match(container.textContent, /输入/);
assert.match(container.textContent, /模型/);
assert.match(container.textContent, /工具/);

await act(async () => {
  container.querySelector('[data-testid="trace-row-tool-row-1"]').click();
  await Promise.resolve();
});
assert.match(container.textContent, /secret-value/);

await act(async () => root.unmount());
dom.window.close();
process.stdout.write('AGENT_UI_INTEGRATION_OK preview_safe=true detail_on_select=true\n');
