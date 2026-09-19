import { agentRunEventRepository } from '../repositories/agentRunEventRepository.js';
import { AgentRun, type AgentRunOptions } from './agentRun.js';
import { attachLangfuseObserver } from './observability/langfuse.js';

/** Creates a production AgentRun backed by the sole configured SQLite persistence adapter. */
export function createDurableAgentRun(options: Omit<AgentRunOptions, 'eventRepository'>): AgentRun {
  const run = new AgentRun({ ...options, eventRepository: agentRunEventRepository });
  attachLangfuseObserver(run);
  return run;
}
