import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentTracePanel } from '../dist/index.js';

const entries = [
  {
    id: 'input-1',
    eventIds: ['input-1'],
    seq: 1,
    runId: 'host-run',
    turnId: 'host-turn',
    lane: 'input',
    kind: 'message',
    label: '用户输入',
    createdAt: '2026-10-21T00:00:00.000Z',
    detailEventIds: ['input-1'],
    synthetic: false,
  },
  {
    id: 'tool-1',
    eventIds: ['tool-1'],
    seq: 2,
    runId: 'host-run',
    turnId: 'host-turn',
    lane: 'tool',
    kind: 'tool',
    label: 'write_file',
    status: 'outcome_unknown',
    createdAt: '2026-10-21T00:00:01.000Z',
    detailEventIds: ['tool-1'],
    synthetic: true,
  },
];

const markup = renderToStaticMarkup(
  createElement(AgentTracePanel, {
    entries,
    loadEvent: async (eventId) => ({
      eventId,
      availability: 'missing',
      historyCompleteness: 'complete',
      errorCode: 'EVENT_NOT_FOUND',
    }),
  }),
);
for (const text of ['Agent 执行轨迹', '用户输入', 'write_file', '结果未知']) {
  if (!markup.includes(text)) throw new Error(`Independent React host is missing ${text}`);
}
if (markup.includes('hidden tool arguments')) {
  throw new Error('Trace preview exposed event detail payload without an explicit selection');
}
process.stdout.write(
  'AGENT_UI_HOST_SMOKE_OK ' + JSON.stringify({ entries: entries.length }) + '\n',
);
