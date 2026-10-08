import { useCallback, useRef, type SetStateAction } from 'react';
import { generateTitle } from '@/services/api';
import { streamAgentRunRecovery } from '@/services/api/agentRunRecovery';
import type { Conversation, Message, SendOptions } from '@/types';
import { parseSlashCommand } from '../commands/slashCommands';
import type { AgentRunStatusData } from '../components/AgentRunStatus';
import type { ReactReducerEvent } from './useReactEventReducer';
import { recordModelConnectionEventOnce } from '../modelConnectionEvents';
import { createChatStreamCallbacks, createToolApprovalCallbacks } from './chatStreamCallbacks';

type MessageWithTempId = Message & { _tempId: string };
type SendStream = (
  conversationId: string,
  content: string,
  callbacks: import('@/types').SendCallbacks,
  agent?: string,
  options?: SendOptions,
) => void;

type ConversationSetter<T> = (value: T, conversationId?: string) => void;

interface UseChatRunActionsOptions {
  activeConversation: string | null;
  conversations: Conversation[];
  messages: Message[];
  activeAgent: string;
  onAutoCreate: (title?: string) => Promise<string | undefined>;
  onTitleUpdate: (id: string, title: string) => void;
  setMessages: ConversationSetter<SetStateAction<Message[]>>;
  setSending: ConversationSetter<boolean>;
  setStreamingId: ConversationSetter<string | null>;
  setActiveAgent: ConversationSetter<string>;
  setAutoRoutedAgent: ConversationSetter<string | null>;
  setAgentRunStatus: ConversationSetter<SetStateAction<AgentRunStatusData | null>>;
  dispatchReactEvent: (event: ReactReducerEvent, conversationId?: string) => void;
  resetReactEvents: (conversationId?: string) => void;
  send: SendStream;
  abort: (conversationId?: string) => void;
}

function createAssistantMessage(conversationId: string): MessageWithTempId {
  const tempId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: tempId,
    _tempId: tempId,
    role: 'assistant',
    content: '',
    reasoning: '',
    conversationId,
    createdAt: new Date().toISOString(),
  };
}

function createUserMessage(conversationId: string, content: string): MessageWithTempId {
  const tempId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: tempId,
    _tempId: tempId,
    role: 'user',
    content,
    conversationId,
    createdAt: new Date().toISOString(),
  };
}

function getTempId(message: Message): string | undefined {
  return '_tempId' in message && typeof message._tempId === 'string' ? message._tempId : undefined;
}

function isAutoRoute(conversation: Conversation | undefined): boolean {
  return (conversation?.routingMode || 'auto') === 'auto' && !conversation?.lockedAgent;
}

function needsGeneratedTitle(conversation: Conversation | undefined, createdNow: boolean): boolean {
  const title = conversation?.title?.trim();
  return createdNow || !title || title === 'New Conversation';
}

function getSendOptions(content: string): SendOptions | undefined {
  const parsed = parseSlashCommand(content);
  return parsed ? { slashCommand: { command: parsed.command, input: parsed.input } } : undefined;
}

function classifyChatError(error: Error): Message['errorCategory'] {
  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  if (status === 401 || status === 403 || status === 404) return 'configuration';
  if (status === 429 || (status !== undefined && status >= 500)) return 'retryable';
  const message = error.message.toLowerCase();
  if (/timeout|network|fetch failed|econn|enotfound|socket|超时|网络/.test(message))
    return 'retryable';
  if (/unauthor|forbidden|not found|model|api key|配置|鉴权/.test(message)) return 'configuration';
  return 'unknown';
}

/** 管理消息流式运行、重新生成和工具审批动作。 */
export default function useChatRunActions({
  activeConversation,
  conversations,
  messages,
  activeAgent,
  onAutoCreate,
  onTitleUpdate,
  setMessages,
  setSending,
  setStreamingId,
  setActiveAgent,
  setAutoRoutedAgent,
  setAgentRunStatus,
  dispatchReactEvent,
  resetReactEvents,
  send,
  abort,
}: UseChatRunActionsOptions) {
  const activeRunsRef = useRef(new Map<string, { tempId: string; finish: () => void }>());

  const updateTempMessage = useCallback(
    (conversationId: string, tempId: string, update: (message: Message) => Message) => {
      setMessages(
        (previous) =>
          previous.map((message) => (getTempId(message) === tempId ? update(message) : message)),
        conversationId,
      );
    },
    [setMessages],
  );

  const runConversation = useCallback(
    (
      conversationId: string,
      content: string,
      tempId: string,
      agent?: string,
      options?: SendOptions,
      onCompleted?: () => void,
      recoveryActionId?: string,
    ) => {
      const streamBufferRef = { current: { id: tempId, content: '' } };
      let streamFailed = false;
      let streamRaf = 0;
      const flushStream = () => {
        const buffer = streamBufferRef.current;
        if (!buffer.content) return;
        const contentToFlush = buffer.content;
        buffer.content = '';
        updateTempMessage(conversationId, buffer.id, (message) => {
          const segments = [...(message.segments || [])];
          const last = segments[segments.length - 1];
          if (last?.type === 'text')
            segments[segments.length - 1] = { ...last, content: last.content + contentToFlush };
          else segments.push({ type: 'text', content: contentToFlush });
          return { ...message, content: message.content + contentToFlush, segments };
        });
      };
      const scheduleFlush = () => {
        if (streamRaf) return;
        streamRaf = requestAnimationFrame(() => {
          streamRaf = 0;
          flushStream();
        });
      };
      const finishStream = (finishedTempId: string, error?: Error) => {
        if (streamRaf) {
          cancelAnimationFrame(streamRaf);
          streamRaf = 0;
        }
        flushStream();
        if (error) {
          streamFailed = true;
          updateTempMessage(conversationId, finishedTempId, (message) => ({
            ...message,
            role: 'error',
            content: error.message,
            errorCategory: classifyChatError(error),
          }));
        }
        setSending(false, conversationId);
        setStreamingId(null, conversationId);
        const activeRun = activeRunsRef.current.get(conversationId);
        if (activeRun?.tempId === finishedTempId) activeRunsRef.current.delete(conversationId);
      };
      activeRunsRef.current.set(conversationId, { tempId, finish: () => finishStream(tempId) });
      const conversation = conversations.find((item) => item.id === conversationId);
      const callbacks = createChatStreamCallbacks({
        tempId,
        isAutoRoute: isAutoRoute(conversation),
        streamBufferRef,
        flushStream,
        scheduleFlush,
        finishStream,
        onCompleted: () => {
          if (!streamFailed) {
            recordModelConnectionEventOnce('first_response_completed_saved');
            onCompleted?.();
          }
        },
        updateTempMessage: (messageTempId, update) =>
          updateTempMessage(conversationId, messageTempId, update),
        setActiveAgent: (value) => setActiveAgent(value, conversationId),
        setAutoRoutedAgent: (value) => setAutoRoutedAgent(value, conversationId),
        setAgentRunStatus: (value) => setAgentRunStatus(value, conversationId),
        dispatchReactEvent: (event) => dispatchReactEvent(event, conversationId),
      });
      if (recoveryActionId) streamAgentRunRecovery(conversationId, recoveryActionId, callbacks);
      else send(conversationId, content, callbacks, agent, options);
    },
    [
      conversations,
      dispatchReactEvent,
      send,
      setActiveAgent,
      setAgentRunStatus,
      setAutoRoutedAgent,
      setSending,
      setStreamingId,
      updateTempMessage,
    ],
  );

  const handleToolApproval = useCallback(
    (approvalId: string, action: 'approve' | 'deny') => {
      if (!activeConversation) return;
      const updateApprovalMessage = (update: (message: Message) => Message) => {
        setMessages(
          (previous) =>
            previous.map((message) =>
              message.segments?.some(
                (segment) => segment.type === 'tool_call' && segment.approvalId === approvalId,
              )
                ? update(message)
                : message,
            ),
          activeConversation,
        );
      };
      setSending(true, activeConversation);
      send(
        activeConversation,
        '',
        createToolApprovalCallbacks(
          approvalId,
          updateApprovalMessage,
          (value) => setSending(value, activeConversation),
          (value) => setStreamingId(value, activeConversation),
          (value) => setAgentRunStatus(value, activeConversation),
          (event) => dispatchReactEvent(event, activeConversation),
        ),
        undefined,
        { control: { type: 'tool_approval', approvalId, action } },
      );
    },
    [
      activeConversation,
      dispatchReactEvent,
      send,
      setAgentRunStatus,
      setMessages,
      setSending,
      setStreamingId,
    ],
  );

  const handleSend = useCallback(
    async (content: string) => {
      let conversationId = activeConversation;
      let createdNow = false;
      if (!conversationId) {
        let newId: string | undefined;
        try {
          newId = await onAutoCreate();
        } catch {
          return;
        }
        if (!newId) return;
        conversationId = newId;
        createdNow = true;
      }
      const conversation = conversations.find((item) => item.id === conversationId);
      const userMessage = createUserMessage(conversationId, content);
      const assistantMessage = createAssistantMessage(conversationId);
      setMessages((previous) => [...previous, userMessage, assistantMessage], conversationId);
      setSending(true, conversationId);
      recordModelConnectionEventOnce('first_message_sent');
      setStreamingId(assistantMessage.id, conversationId);
      resetReactEvents(conversationId);
      const shouldGenerateTitle = needsGeneratedTitle(conversation, createdNow);
      const onCompleted = shouldGenerateTitle
        ? () => {
            generateTitle(conversationId)
              .then((data) => {
                if (data?.title) onTitleUpdate(conversationId, data.title);
              })
              .catch(() => {});
          }
        : undefined;
      runConversation(
        conversationId,
        content,
        assistantMessage._tempId,
        isAutoRoute(conversation) ? undefined : activeAgent,
        getSendOptions(content),
        onCompleted,
      );
    },
    [
      activeAgent,
      activeConversation,
      conversations,
      onAutoCreate,
      onTitleUpdate,
      resetReactEvents,
      runConversation,
      setMessages,
      setSending,
      setStreamingId,
    ],
  );

  const handleRegenerate = useCallback(() => {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUserMessage || !activeConversation) return;
    const lastMessage = messages[messages.length - 1];
    const assistantMessage = createAssistantMessage(activeConversation);
    setMessages(
      (previous) => [
        ...previous.filter((message) => message.id !== lastMessage?.id),
        assistantMessage,
      ],
      activeConversation,
    );
    setSending(true, activeConversation);
    setStreamingId(assistantMessage.id, activeConversation);
    resetReactEvents(activeConversation);
    runConversation(
      activeConversation,
      lastUserMessage.content,
      assistantMessage._tempId,
      undefined,
      { regenerate: true, ...getSendOptions(lastUserMessage.content) },
    );
  }, [
    activeConversation,
    messages,
    resetReactEvents,
    runConversation,
    setMessages,
    setSending,
    setStreamingId,
  ]);

  const handleRecoveryStream = useCallback(
    (actionId: string) => {
      if (!activeConversation) return;
      const assistantMessage = createAssistantMessage(activeConversation);
      setMessages((previous) => [...previous, assistantMessage], activeConversation);
      setSending(true, activeConversation);
      setStreamingId(assistantMessage.id, activeConversation);
      resetReactEvents(activeConversation);
      runConversation(
        activeConversation,
        '',
        assistantMessage._tempId,
        undefined,
        undefined,
        undefined,
        actionId,
      );
    },
    [
      activeConversation,
      resetReactEvents,
      runConversation,
      setMessages,
      setSending,
      setStreamingId,
    ],
  );

  const handleStop = useCallback(() => {
    if (!activeConversation) return;
    abort(activeConversation);
    activeRunsRef.current.get(activeConversation)?.finish();
  }, [abort, activeConversation]);

  return { handleSend, handleRegenerate, handleStop, handleToolApproval, handleRecoveryStream };
}
