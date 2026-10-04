import { agentRunEventRepository } from '../infrastructure/persistence/agent-run-event-repository.js';
import { AgentRun, type AgentRunOptions } from '../agent-runtime/agent-run.js';
import { attachLangfuseObserver } from '../services/observability/langfuse.js';

/** Creates a production AgentRun backed by the sole configured SQLite persistence adapter. */
export function createDurableAgentRun(options: Omit<AgentRunOptions, 'eventRepository'>): AgentRun {
  const run = new AgentRun({ ...options, eventRepository: agentRunEventRepository });
  attachLangfuseObserver(run);
  return run;
}
