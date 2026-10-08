import type { SetStateAction } from 'react';
import type { Message } from '@/types';
import type { AgentRunStatusData } from '../components/AgentRunStatus';
import {
  createInitialReactEventState,
  reduceReactEvent,
  type ReactEventState,
  type ReactReducerEvent,
} from './useReactEventReducer';

export interface ChatRuntimeState {
  messages: Message[];
  loading: boolean;
  loaded: boolean;
  sending: boolean;
  streamingId: string | null;
  activeAgent: string;
  autoRoutedAgent: string | null;
  reactState: ReactEventState;
  agentRunStatus: AgentRunStatusData | null;
}

type Listener = () => void;

const runtimes = new Map<string, ChatRuntimeState>();
const listeners = new Map<string, Set<Listener>>();

const emptyRuntime: ChatRuntimeState = {
  messages: [],
  loading: false,
  loaded: true,
  sending: false,
  streamingId: null,
  activeAgent: 'general',
  autoRoutedAgent: null,
  reactState: createInitialReactEventState(),
  agentRunStatus: null,
};

function createRuntime(): ChatRuntimeState {
  return {
    messages: [],
    loading: false,
    loaded: false,
    sending: false,
    streamingId: null,
    activeAgent: 'general',
    autoRoutedAgent: null,
    reactState: createInitialReactEventState(),
    agentRunStatus: null,
  };
}

function notify(conversationId: string): void {
  listeners.get(conversationId)?.forEach((listener) => listener());
}

export function getRuntime(conversationId: string): ChatRuntimeState {
  const existing = runtimes.get(conversationId);
  if (existing) return existing;
  const runtime = createRuntime();
  runtimes.set(conversationId, runtime);
  return runtime;
}

export function getEmptyRuntime(): ChatRuntimeState {
  return emptyRuntime;
}

export function subscribe(conversationId: string, listener: Listener): () => void {
  const conversationListeners = listeners.get(conversationId) || new Set<Listener>();
  conversationListeners.add(listener);
  listeners.set(conversationId, conversationListeners);
  return () => {
    conversationListeners.delete(listener);
    if (conversationListeners.size === 0) listeners.delete(conversationId);
  };
}

function updateRuntime(conversationId: string, updater: (runtime: ChatRuntimeState) => ChatRuntimeState): void {
  runtimes.set(conversationId, updater(getRuntime(conversationId)));
  notify(conversationId);
}

export function setRuntime(conversationId: string, updates: Partial<ChatRuntimeState>): void {
  updateRuntime(conversationId, (runtime) => ({ ...runtime, ...updates }));
}

export function setMessages(conversationId: string, action: SetStateAction<Message[]>): void {
  updateRuntime(conversationId, (runtime) => ({
    ...runtime,
    messages: typeof action === 'function' ? action(runtime.messages) : action,
  }));
}

export function dispatchReactEvent(conversationId: string, event: ReactReducerEvent): void {
  updateRuntime(conversationId, (runtime) => ({
    ...runtime,
    reactState: reduceReactEvent(runtime.reactState, event),
  }));
}

export function resetReactEvents(conversationId: string): void {
  setRuntime(conversationId, {
    reactState: createInitialReactEventState(),
    agentRunStatus: null,
    autoRoutedAgent: null,
  });
}

export function beginLoading(conversationId: string): void {
  setRuntime(conversationId, { loading: true });
}

export function finishLoading(conversationId: string, messages: Message[]): void {
  setRuntime(conversationId, { messages, loading: false, loaded: true });
}
