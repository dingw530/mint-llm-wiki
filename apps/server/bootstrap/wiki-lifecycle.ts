import { runWikiLifecycleOnce } from '../domains/wiki/index.js';

/** 启动低频生命周期调度；定时器 unref 后不会阻止进程正常退出。 */
export function startWikiLifecycleProcessing(
  intervalMs = 6 * 60 * 60 * 1000,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    try {
      runWikiLifecycleOnce();
    } catch (error) {
      console.error('[wiki-lifecycle] run failed:', error);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}
