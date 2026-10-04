import { getAdapter } from '../services/adapters/apiAdapter.js';
import { createModelConnectionVerifier } from '../infrastructure/ai/model-connection-verification.js';

const verifier = createModelConnectionVerifier(getAdapter);

/** List model IDs through the configured adapter-independent connection interface. */
export const listModels = verifier.listModels;

/** Verify a model connection using the process adapter registry before persistence. */
export const testConnection = verifier.testConnection;

export type {
  ConnectionErrorCategory,
  ConnectionInput,
  ConnectionTestResult,
  ModelListResult,
  ModelConnectionService,
  SupportedApiType,
} from '../infrastructure/ai/model-connection-verification.js';
