import type { WikiJob } from '../../domains/wiki/index.js';

export type JobEventListener = (job: WikiJob) => void;

const listeners = new Set<JobEventListener>();

/** 发布任务状态变化；事件总线不保存事实，断线恢复依赖 JobStore 快照。 */
export function publishJobEvent(job: WikiJob): void {
  for (const listener of listeners) listener(job);
}

/** 订阅任务状态变化，返回取消订阅函数。 */
export function subscribeJobEvents(listener: JobEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
