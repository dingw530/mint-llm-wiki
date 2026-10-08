import type { SendCallbacks, SendOptions, StreamReturn } from '@/types';
import { BASE_URL, getElectronAPI, isElectron, parseSSEChunk } from '../api/_base';

export function sendMessageStream(
  conversationId: string,
  content: string,
  callbacks: SendCallbacks & { regenerate?: boolean },
  agent?: string,
): StreamReturn;
export function sendMessageStream(
  conversationId: string,
  content: string,
  callbacks: SendCallbacks,
  agent?: string,
  options?: SendOptions,
): StreamReturn;
export function sendMessageStream(
  conversationId: string,
  content: string,
  callbacks: SendCallbacks,
  agent?: string,
  options?: SendOptions,
): StreamReturn {
  // Electron IPC 路径
  if (isElectron() && !options?.control) {
    const api = getElectronAPI()!;
    const lastThought = { value: '' };
    const onChunk = (raw: string) => {
      try {
        parseSSEChunk(JSON.parse(raw), callbacks, lastThought);
      } catch {
        /* Ignore malformed chunks. */
      }
    };
    let cleanup = () => {};
    const onDone = () => {
      cleanup();
      callbacks.onDone?.();
    };
    const onError = (err: string) => {
      cleanup();
      callbacks.onError?.(new Error(err));
    };
    const removeChunkListener = api.onChunk(conversationId, onChunk);
    const removeDoneListener = api.onDone(conversationId, onDone);
    const removeErrorListener = api.onError(conversationId, onError);
    cleanup = () => {
      removeChunkListener();
      removeDoneListener();
      removeErrorListener();
    };
    api.sendMessage(conversationId, content, agent, !!options?.regenerate, options?.slashCommand);

    return {
      abort: () => {
        cleanup();
      },
    };
  }

  // HTTP SSE 路径
  const controller = new AbortController();
  const body: Record<string, unknown> = options?.control
    ? { control: options.control }
    : { content };
  if (options?.regenerate) body.regenerate = true;
  if (agent !== undefined) body.agent = agent;

  const lastThought = { value: '' };

  fetch(`${BASE_URL}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw Object.assign(new Error(err.error || `HTTP ${response.status}`), {
          status: response.status,
        });
      }
      const reader = response.body!.getReader();
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
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;
          try {
            parseSSEChunk(JSON.parse(dataStr), callbacks, lastThought);
          } catch {
            /* Ignore malformed chunks. */
          }
        }
      }

      if (buffer.startsWith('data: ')) {
        const dataStr = buffer.slice(6).trim();
        if (dataStr !== '[DONE]') {
          try {
            parseSSEChunk(JSON.parse(dataStr), callbacks, lastThought);
          } catch {
            /* Ignore malformed chunks. */
          }
        }
      }

      callbacks.onDone?.();
    })
    .catch((err) => {
      if (err.name === 'AbortError') return;
      callbacks.onError?.(err);
    });

  return { abort: () => controller.abort() };
}
