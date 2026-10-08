import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from 'react';
import { fetchAgents, getMessages, getSettings } from '@/services/api';
import type { Agent, Message } from '@/types';
import type { ReactReducerEvent } from './useReactEventReducer';
import type { AgentRunStatusData } from '../components/AgentRunStatus';
import * as chatRuntimeStore from './chatRuntimeStore';

interface UseChatConversationDataOptions {
  activeConversation: string | null;
  initialMessage?: string | null;
}

/**
 * 管理当前会话的数据加载、运行轨迹和页面级显示状态。
 * @param options 当前会话和外部初始消息
 * @returns 会话状态、引用及 ReAct 事件操作
 */
export default function useChatConversationData({
  activeConversation,
  initialMessage,
}: UseChatConversationDataOptions) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showReactSteps, setShowReactSteps] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const conversationId = activeConversation || '';
  const runtime = useSyncExternalStore(
    useCallback(
      (listener) =>
        conversationId ? chatRuntimeStore.subscribe(conversationId, listener) : () => {},
      [conversationId],
    ),
    useCallback(
      () =>
        conversationId
          ? chatRuntimeStore.getRuntime(conversationId)
          : chatRuntimeStore.getEmptyRuntime(),
      [conversationId],
    ),
    useCallback(
      () =>
        conversationId
          ? chatRuntimeStore.getRuntime(conversationId)
          : chatRuntimeStore.getEmptyRuntime(),
      [conversationId],
    ),
  );

  const dispatchReactEvent = useCallback(
    (event: ReactReducerEvent, targetConversationId = conversationId) => {
      if (targetConversationId) chatRuntimeStore.dispatchReactEvent(targetConversationId, event);
    },
    [conversationId],
  );

  const resetReactEvents = useCallback(
    (targetConversationId = conversationId) => {
      if (targetConversationId) chatRuntimeStore.resetReactEvents(targetConversationId);
    },
    [conversationId],
  );

  const setMessages = useCallback(
    (action: SetStateAction<Message[]>, targetConversationId = conversationId) => {
      if (targetConversationId) chatRuntimeStore.setMessages(targetConversationId, action);
    },
    [conversationId],
  );
  const setSending = useCallback(
    (sending: boolean, targetConversationId = conversationId) => {
      if (targetConversationId) chatRuntimeStore.setRuntime(targetConversationId, { sending });
    },
    [conversationId],
  );
  const setStreamingId = useCallback(
    (streamingId: string | null, targetConversationId = conversationId) => {
      if (targetConversationId) chatRuntimeStore.setRuntime(targetConversationId, { streamingId });
    },
    [conversationId],
  );
  const setActiveAgent = useCallback(
    (activeAgent: string, targetConversationId = conversationId) => {
      if (targetConversationId) chatRuntimeStore.setRuntime(targetConversationId, { activeAgent });
    },
    [conversationId],
  );
  const setAutoRoutedAgent = useCallback(
    (autoRoutedAgent: string | null, targetConversationId = conversationId) => {
      if (targetConversationId)
        chatRuntimeStore.setRuntime(targetConversationId, { autoRoutedAgent });
    },
    [conversationId],
  );
  const setAgentRunStatus = useCallback(
    (action: SetStateAction<AgentRunStatusData | null>, targetConversationId = conversationId) => {
      if (!targetConversationId) return;
      const previous = chatRuntimeStore.getRuntime(targetConversationId).agentRunStatus;
      const agentRunStatus = typeof action === 'function' ? action(previous) : action;
      chatRuntimeStore.setRuntime(targetConversationId, { agentRunStatus });
    },
    [conversationId],
  );

  useEffect(() => {
    fetchAgents()
      .then((data) => setAgents(data.agents || []))
      .catch(() =>
        setAgents([
          {
            id: 'general',
            name: '通用助手',
            label: '通用助手',
            description: '',
            type: 'general',
            systemPrompt: null,
            mcpServerIds: [],
            available: true,
            errorMessage: null,
            triggerKeywords: [],
            createdAt: '',
            updatedAt: '',
          },
        ]),
      );
  }, []);

  useEffect(() => {
    getSettings()
      .then((data) => setShowReactSteps(data.showReactSteps !== false))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    if (initialMessage) {
      chatRuntimeStore.setRuntime(conversationId, { loading: false, messages: [] });
      return;
    }
    const currentRuntime = chatRuntimeStore.getRuntime(conversationId);
    if (currentRuntime.loaded || currentRuntime.sending) return;
    chatRuntimeStore.beginLoading(conversationId);
    getMessages(conversationId)
      .then((data) => chatRuntimeStore.finishLoading(conversationId, data.messages || []))
      .catch((error: unknown) => console.error('Failed to load messages:', error))
      .finally(() => chatRuntimeStore.setRuntime(conversationId, { loading: false }));
  }, [conversationId, initialMessage]);

  useEffect(() => {
    if (runtime.messages.length) messagesEndRef.current?.scrollIntoView(false);
  }, [runtime.messages]);

  return {
    messages: runtime.messages,
    setMessages,
    loading: runtime.loading,
    sending: runtime.sending,
    streamingId: runtime.streamingId,
    setSending,
    setStreamingId,
    agents,
    setAgents,
    activeAgent: runtime.activeAgent,
    setActiveAgent,
    autoRoutedAgent: runtime.autoRoutedAgent,
    setAutoRoutedAgent,
    reactSteps: runtime.reactState.steps,
    reactRunId: runtime.reactState.runId,
    decisionTrace: runtime.reactState.decisionTrace,
    agentRunStatus: runtime.agentRunStatus,
    setAgentRunStatus,
    showReactSteps,
    messagesEndRef,
    dispatchReactEvent,
    resetReactEvents,
  };
}
