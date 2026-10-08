import { useRef, useCallback } from 'react';
import { sendMessageStream } from '../services/api';
import type { SendCallbacks, SendOptions } from '../types';

interface UseSSEReturn {
  send: (
    conversationId: string,
    content: string,
    callbacks: SendCallbacks,
    agent?: string,
    options?: SendOptions,
  ) => void;
  abort: (conversationId?: string) => void;
}

/**
 * Hook to manage SSE streaming for AI responses.
 * Returns a send function and an abort function.
 */
export default function useSSE(): UseSSEReturn {
  const abortRefs = useRef(new Map<string, () => void>());

  const send = useCallback<UseSSEReturn['send']>((conversationId, content, callbacks, agent, options = {}) => {
    const previousAbort = abortRefs.current.get(conversationId);
    if (previousAbort) {
      previousAbort();
      abortRefs.current.delete(conversationId);
    }
    const { abort } = sendMessageStream(conversationId, content, callbacks, agent, options);
    abortRefs.current.set(conversationId, abort);
  }, []);

  const abort = useCallback((conversationId?: string) => {
    if (conversationId) {
      const currentAbort = abortRefs.current.get(conversationId);
      currentAbort?.();
      abortRefs.current.delete(conversationId);
      return;
    }
    abortRefs.current.forEach((currentAbort) => currentAbort());
    abortRefs.current.clear();
  }, []);

  return { send, abort };
}
