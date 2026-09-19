/**
 * 任务队列适配接口。业务层只依赖该接口，未来可替换为 Redis/BullMQ 实现。
 */
export interface JobQueue {
  start(worker: (jobId: string) => Promise<void>): void;
  enqueue(jobId: string): void;
  stop(): Promise<void>;
}

/**
 * 当前阶段的单进程队列实现。任务事实由 SQLite 保存，队列只负责触发 worker。
 */
export class InProcessJobQueue implements JobQueue {
  private worker?: (jobId: string) => Promise<void>;
  private running = false;
  private scheduled = false;
  private activePromise?: Promise<void>;
  private scheduledPromise?: Promise<void>;

  start(worker: (jobId: string) => Promise<void>): void {
    this.worker = worker;
    this.running = true;
  }

  enqueue(_jobId: string): void {
    if (!this.running || this.scheduled) return;
    this.scheduled = true;
    this.scheduledPromise = new Promise<void>((resolve) => {
      setImmediate(() => {
        this.scheduled = false;
        this.scheduledPromise = undefined;
        if (!this.running) {
          resolve();
          return;
        }
        this.activePromise = this.drain();
        void this.activePromise.then(resolve, resolve).finally(() => {
          this.activePromise = undefined;
        });
      });
    });
  }

  stop(): Promise<void> {
    this.running = false;
    this.worker = undefined;
    return Promise.all([this.activePromise, this.scheduledPromise]).then(() => undefined);
  }

  private async drain(): Promise<void> {
    if (!this.running || !this.worker) return;
    // JobStore.claimNext() 在 worker 内部完成原子领取，后续 adapter 可替换领取策略。
    await this.worker('next');
  }
}
