import type { SendCallbacks, StreamReturn } from '@/types';
import { BASE_URL, callEndpoint, getElectronAPI, isElectron, parseSSEChunk } from './_base';

export type RecoveryAction = 'continue' | 'retry' | 'abandon';

export interface RecoverableAgentRun {
  runId: string;
  status: 'interrupted';
  unknownToolCount?: number;
  unknownTools: Array<{ callId: string; toolName: string; recoveryLevel: string }>;
  actions: RecoveryAction[];
}

export interface RecoveryActionResult {
  action: { id: string; action: RecoveryAction; status: string; successorRunId?: string };
}

/** Reads recovery-safe run summaries for one conversation. */
export function getRecoverableAgentRuns(
  conversationId: string,
): Promise<{ runs: RecoverableAgentRun[] }> {
  return callEndpoint('conversations:listRecoverableRuns', conversationId);
}

/** Reserves a user recovery decision with a stable client idempotency key. */
export function resolveAgentRunRecovery(
  conversationId: string,
  runId: string,
  action: RecoveryAction,
  idempotencyKey: string,
  confirmation = false,
): Promise<RecoveryActionResult> {
  return callEndpoint('conversations:resolveRecoveryAction', conversationId, runId, {
    action,
    idempotencyKey,
    confirmation,
  });
}

/** Streams a reserved recovery action over IPC in Electron or SSE in the web client. */
export function streamAgentRunRecovery(
  conversationId: string,
  actionId: string,
  callbacks: SendCallbacks,
): StreamReturn {
  if (isElectron()) return streamElectronRecovery(conversationId, actionId, callbacks);
  return streamHttpRecovery(conversationId, actionId, callbacks);
}

function streamElectronRecovery(
  conversationId: string,
  actionId: string,
  callbacks: SendCallbacks,
): StreamReturn {
  const api = getElectronAPI();
  if (!api) return { abort: () => callbacks.onError?.(new Error('Electron API unavailable')) };
  const lastThought = { value: '' };
  const onChunk = (raw: string) => {
    try {
      parseSSEChunk(JSON.parse(raw), callbacks, lastThought);
    } catch {
      // Ignore malformed chunks from the IPC transport.
    }
  };
  let cleanup = () => {};
  const onDone = () => {
    cleanup();
    callbacks.onDone?.();
  };
  const onError = (error: string) => {
    cleanup();
    callbacks.onError?.(new Error(error));
  };
  const removeChunkListener = api.onChunk(conversationId, onChunk);
  const removeDoneListener = api.onDone(conversationId, onDone);
  const removeErrorListener = api.onError(conversationId, onError);
  cleanup = () => {
    removeChunkListener();
    removeDoneListener();
    removeErrorListener();
  };
  api.streamRecoveryAction(conversationId, actionId);
  return { abort: cleanup };
}

function streamHttpRecovery(
  conversationId: string,
  actionId: string,
  callbacks: SendCallbacks,
): StreamReturn {
  const controller = new AbortController();
  const lastThought = { value: '' };
  fetch(
    `${BASE_URL}/conversations/${conversationId}/agent-runs/recovery-actions/${actionId}/stream`,
    {
      method: 'POST',
      signal: controller.signal,
    },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Recovery stream has no response body');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            parseSSEChunk(JSON.parse(data), callbacks, lastThought);
          } catch {
            // Ignore malformed SSE data.
          }
        }
      }
      callbacks.onDone?.();
    })
    .catch((error: Error) => {
      if (error.name !== 'AbortError') callbacks.onError?.(error);
    });
  return { abort: () => controller.abort() };
}
