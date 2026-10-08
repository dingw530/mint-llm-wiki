import type { PersistedUiBlock } from '../../../types.js';

/** 官方 A2UI v0.9 消息的服务端结构；具体 schema 由客户端官方解析器校验。 */
export type A2uiMessage =
  | { version: 'v0.9'; createSurface: { surfaceId: string; catalogId: string } }
  | {
      version: 'v0.9';
      updateComponents: {
        surfaceId: string;
        components: Array<{ id: string; component: string; data: { path: string } }>;
      };
    }
  | { version: 'v0.9'; updateDataModel: { surfaceId: string; path: string; value: unknown } }
  | { version: 'v0.9'; deleteSurface: { surfaceId: string } };

export interface A2UIInput {
  runId: string;
  round: number;
  event:
    | { kind: 'tool_result'; toolName: string; toolCallId?: string; result: unknown }
    | { kind: 'answer_chunk'; content: string }
    | { kind: 'answer_completed'; content: string };
}

/** Identifies the tool result that produced one immutable evidence snapshot. */
export interface A2UIReferenceContext {
  runId: string;
  round: number;
  toolCallId?: string;
}

export interface A2UIEmission {
  segmentId: string;
  surfaceId: string;
  messages: A2uiMessage[];
  block?: PersistedUiBlock;
}

export interface A2UIReference {
  evidenceId: string;
  refId: string;
  title: string;
  file: string;
  heading: string;
  snippet: string;
  chunkId: string;
  granularity: 'chunk' | 'page' | 'source-family';
  contentHash: string;
  score?: number;
  matchTypes?: string[];
  pageStatus?: string | null;
  lastVerifiedAt?: string | null;
  lexicalRank?: number | null;
  vectorRank?: number | null;
  distance?: number | null;
}

export interface A2UIProviderResult {
  nextReferenceIndex: number;
  contextResult?: string;
}

export interface A2UIProvider {
  readonly toolName: string;
  handleToolResult(
    rawResult: unknown,
    nextReferenceIndex: number,
    context?: A2UIReferenceContext,
  ): A2UIProviderResult;
  findReference(refId: string): A2UIReference | null;
  createEmission(
    reference: A2UIReference,
    blockIndex: number,
    textOffset: number,
  ): A2UIEmission | null;
  getReferences?(): A2UIReference[];
}

export type A2UIOutput =
  { kind: 'text'; content: string } | { kind: 'surface'; emission: A2UIEmission };

export interface A2UIHandleResult {
  outputs: A2UIOutput[];
  contextResult?: string;
}

export interface A2UIComponentRegistration {
  kind: string;
  catalogId: string;
  componentName: string;
  dataSchemaVersion: number;
  dataSchema: Record<string, unknown>;
  enabled: boolean;
}
