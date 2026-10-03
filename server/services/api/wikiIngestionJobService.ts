import * as settingsService from './settingsService.js';
import {
  WikiIngestionJobService,
  type WikiIngestionJobDependencies,
  cleanupWikiIngestionJobStagedFiles,
  ingestWikiSource,
} from '../../domains/wiki/index.js';
import { parseFile } from '../utils/fileParseService.js';
import {
  archiveWikiUpload,
  discardWikiStagedFile,
  readArchivedWikiFile,
} from '../../infrastructure/filesystem/wiki-ingestion-files.js';
import * as jobStore from '../../infrastructure/jobs/sqlite-job-store.js';
import { InProcessJobQueue } from '../../infrastructure/jobs/job-queue.js';
import {
  createJobStoreAdapter,
  sqliteJobStore,
  type JobStore,
} from '../../infrastructure/jobs/job-store.js';

/** Overrides for the legacy HTTP/Electron worker composition and its tests. */
export interface WikiIngestionJobServiceOverrides extends Partial<
  Omit<WikiIngestionJobDependencies, 'store' | 'queue'>
> {
  queue?: WikiIngestionJobDependencies['queue'];
  store?: JobStore;
  createJob?: typeof jobStore.createJob;
  updateJob?: typeof jobStore.updateJob;
  getJob?: typeof jobStore.getJob;
  getJobByIdempotencyKey?: typeof jobStore.getByIdempotencyKey;
  listJobs?: typeof jobStore.listJobs;
  removeJob?: typeof jobStore.removeJob;
  getJobPayload?: typeof jobStore.getJobPayload;
  countJobs?: typeof jobStore.countJobs;
  claimNext?: typeof jobStore.claimNext;
  recoverRunning?: typeof jobStore.recoverRunning;
}

const defaultDependencies: WikiIngestionJobServiceOverrides = {
  getAiSettings: () => settingsService.getAiSettings(),
  parseFile,
  ingestWikiSource,
  archiveWikiUpload,
  discardWikiStagedFile,
  cleanupIngestionStagedFiles: cleanupWikiIngestionJobStagedFiles,
  readArchivedWikiFile,
  createJob: jobStore.createJob,
  updateJob: jobStore.updateJob,
  getJob: jobStore.getJob,
  getJobByIdempotencyKey: jobStore.getByIdempotencyKey,
  listJobs: jobStore.listJobs,
  removeJob: jobStore.removeJob,
  getJobPayload: jobStore.getJobPayload,
  countJobs: jobStore.countJobs,
  claimNext: jobStore.claimNext,
  recoverRunning: jobStore.recoverRunning,
  queue: new InProcessJobQueue(),
  store: sqliteJobStore,
};

/** Compose the domain worker with the existing HTTP/Electron runtime adapters. */
export function createWikiIngestionJobService(
  overrides: WikiIngestionJobServiceOverrides = {},
): WikiIngestionJobService {
  const merged = { ...defaultDependencies, ...overrides };
  const store =
    overrides.store ||
    createJobStoreAdapter({
      create: overrides.createJob,
      get: overrides.getJob,
      getByIdempotencyKey: overrides.getJobByIdempotencyKey,
      list: overrides.listJobs,
      count: overrides.countJobs,
      update: overrides.updateJob,
      getPayload: overrides.getJobPayload,
      claimNext: overrides.claimNext,
      recoverRunning: overrides.recoverRunning,
      remove: overrides.removeJob,
    });
  const dependencies: WikiIngestionJobDependencies = {
    getAiSettings: merged.getAiSettings!,
    parseFile: merged.parseFile!,
    ingestWikiSource: merged.ingestWikiSource!,
    archiveWikiUpload: merged.archiveWikiUpload!,
    discardWikiStagedFile: merged.discardWikiStagedFile!,
    cleanupIngestionStagedFiles: merged.cleanupIngestionStagedFiles!,
    readArchivedWikiFile: merged.readArchivedWikiFile!,
    queue: merged.queue!,
    store,
  };
  return new WikiIngestionJobService(dependencies);
}

export const wikiIngestionJobService = createWikiIngestionJobService();

export type { WikiIngestionJobDependencies } from '../../domains/wiki/index.js';
