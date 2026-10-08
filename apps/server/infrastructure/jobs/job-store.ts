import type {
  WikiJob,
  WikiJobCreateOptions,
  WikiJobListFilter,
  WikiJobStatus,
  WikiJobUpdate,
} from '../../domains/wiki/index.js';
import * as sqliteStore from './sqlite-job-store.js';

/**
 * 摄入任务的事实存储端口。
 * 业务层只依赖此接口，不感知 SQLite、Redis 或其他存储实现。
 */
export interface JobStore {
  create(fileName: string, fileSize: number, options?: WikiJobCreateOptions): string;
  get(id: string): WikiJob | undefined;
  getByIdempotencyKey(key: string): WikiJob | undefined;
  list(filter?: WikiJobListFilter): WikiJob[];
  count(status?: WikiJobStatus): number;
  update(id: string, updates: WikiJobUpdate): WikiJob | undefined;
  getPayload(id: string): Record<string, unknown>;
  claimNext(): WikiJob | undefined;
  recoverRunning(): number;
  remove(id: string): boolean;
}

/** SQLite 任务存储适配器；替换为 Redis 时实现同一 JobStore 接口即可。 */
export class SqliteJobStore implements JobStore {
  create(fileName: string, fileSize: number, options: WikiJobCreateOptions = {}): string {
    return sqliteStore.createJob(fileName, fileSize, options);
  }

  get(id: string): WikiJob | undefined {
    return sqliteStore.getJob(id);
  }

  getByIdempotencyKey(key: string): WikiJob | undefined {
    return sqliteStore.getByIdempotencyKey(key);
  }

  list(filter: WikiJobListFilter = {}): WikiJob[] {
    return sqliteStore.listJobs(filter);
  }

  count(status?: WikiJobStatus): number {
    return sqliteStore.countJobs(status);
  }

  update(id: string, updates: WikiJobUpdate): WikiJob | undefined {
    return sqliteStore.updateJob(id, updates);
  }

  getPayload(id: string): Record<string, unknown> {
    return sqliteStore.getJobPayload(id);
  }

  claimNext(): WikiJob | undefined {
    return sqliteStore.claimNext();
  }

  recoverRunning(): number {
    return sqliteStore.recoverRunning();
  }

  remove(id: string): boolean {
    return sqliteStore.removeJob(id);
  }
}

export const sqliteJobStore: JobStore = new SqliteJobStore();

/**
 * 将旧的函数依赖组装成 JobStore，供现有测试和渐进迁移使用。
 * 新代码应直接注入 JobStore 实例。
 */
export function createJobStoreAdapter(overrides: Partial<JobStore> = {}): JobStore {
  return {
    create: overrides.create || sqliteJobStore.create.bind(sqliteJobStore),
    get: overrides.get || sqliteJobStore.get.bind(sqliteJobStore),
    getByIdempotencyKey:
      overrides.getByIdempotencyKey || sqliteJobStore.getByIdempotencyKey.bind(sqliteJobStore),
    list: overrides.list || sqliteJobStore.list.bind(sqliteJobStore),
    count: overrides.count || sqliteJobStore.count.bind(sqliteJobStore),
    update: overrides.update || sqliteJobStore.update.bind(sqliteJobStore),
    getPayload: overrides.getPayload || sqliteJobStore.getPayload.bind(sqliteJobStore),
    claimNext: overrides.claimNext || sqliteJobStore.claimNext.bind(sqliteJobStore),
    recoverRunning: overrides.recoverRunning || sqliteJobStore.recoverRunning.bind(sqliteJobStore),
    remove: overrides.remove || sqliteJobStore.remove.bind(sqliteJobStore),
  };
}
