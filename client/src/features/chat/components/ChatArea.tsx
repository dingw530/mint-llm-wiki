import { useCallback, useEffect, useState } from 'react';
import type { MarkdownRendererProps } from '@/shared/components/MarkdownRenderer';
import ChatAreaView from './ChatAreaView';
import useSSE from '@/hooks/useSSE';
import type { Conversation, EndpointOutput } from '@/types';
import useChatConversationData from '../hooks/useChatConversationData';
import useChatRunActions from '../hooks/useChatRunActions';
import useChatAgentActions from '../hooks/useChatAgentActions';
import {
  getRecoverableAgentRuns,
  resolveAgentRunRecovery,
  type RecoverableAgentRun,
  type RecoveryAction,
} from '@/services/api/agentRunRecovery';

export interface ChatAreaProps {
  activeConversation: string | null;
  conversations: Conversation[];
  onAutoCreate: (title?: string) => Promise<string | undefined>;
  onTitleUpdate: (id: string, title: string) => void;
  onUpdateConversation?: (convId: string, updates: Partial<Conversation>) => void;
  activeEndpoint: EndpointOutput | null;
  endpoints: EndpointOutput[];
  onEndpointChange: () => Promise<void>;
  chatEnabled: boolean;
  connectionMode: 'onboarding' | 'repair' | null;
  repairEndpoint: EndpointOutput | null;
  onConnectModel: (mode?: 'onboarding' | 'repair') => void;
  onSkipOnboarding: () => void;
  onCloseConnection: () => void;
  onConnectionSuccess: (endpoint: EndpointOutput) => Promise<void>;
  initialMessage?: string | null;
  onInitialMessageSent?: () => void;
  onLinkClick?: MarkdownRendererProps['onLinkClick'];
}

/** 聊天页控制器：组合页面数据、运行动作和代理选择，再交给纯视图渲染。 */
export default function ChatArea({
  activeConversation,
  conversations,
  onAutoCreate,
  onTitleUpdate,
  onUpdateConversation,
  activeEndpoint,
  endpoints,
  onEndpointChange,
  chatEnabled,
  connectionMode,
  repairEndpoint,
  onConnectModel,
  onSkipOnboarding,
  onCloseConnection,
  onConnectionSuccess,
  initialMessage,
  onInitialMessageSent,
  onLinkClick,
}: ChatAreaProps) {
  const { send, abort } = useSSE();
  const [recoverableRuns, setRecoverableRuns] = useState<RecoverableAgentRun[]>([]);
  const conversationData = useChatConversationData({ activeConversation, initialMessage });
  const {
    messages,
    setMessages,
    loading,
    agents,
    activeAgent,
    setActiveAgent,
    autoRoutedAgent,
    setAutoRoutedAgent,
    reactSteps,
    reactRunId,
    decisionTrace,
    agentRunStatus,
    setAgentRunStatus,
    showReactSteps,
    messagesEndRef,
    dispatchReactEvent,
    resetReactEvents,
  } = conversationData;

  const runActions = useChatRunActions({
    activeConversation,
    conversations,
    messages,
    activeAgent,
    onAutoCreate,
    onTitleUpdate,
    setMessages,
    setSending: conversationData.setSending,
    setStreamingId: conversationData.setStreamingId,
    setActiveAgent,
    setAutoRoutedAgent,
    setAgentRunStatus,
    dispatchReactEvent,
    resetReactEvents,
    send,
    abort,
  });
  const { handleSend, handleRecoveryStream } = runActions;

  const refreshRecoverableRuns = useCallback(() => {
    if (!activeConversation) {
      setRecoverableRuns([]);
      return;
    }
    getRecoverableAgentRuns(activeConversation)
      .then((result) => setRecoverableRuns(result.runs))
      .catch(() => setRecoverableRuns([]));
  }, [activeConversation]);

  useEffect(() => {
    refreshRecoverableRuns();
  }, [refreshRecoverableRuns]);

  const handleRecoveryAction = useCallback(
    async (
      runId: string,
      action: RecoveryAction,
      confirmation: boolean,
      idempotencyKey: string,
    ) => {
      if (!activeConversation) return;
      const result = await resolveAgentRunRecovery(
        activeConversation,
        runId,
        action,
        idempotencyKey,
        confirmation,
      );
      if (action !== 'abandon' && result.action.successorRunId) {
        handleRecoveryStream(result.action.id);
      }
      setRecoverableRuns((runs) => runs.filter((run) => run.runId !== runId));
    },
    [activeConversation, handleRecoveryStream],
  );

  useEffect(() => {
    if (!initialMessage || !chatEnabled || conversationData.sending) return;
    handleSend(initialMessage);
    onInitialMessageSent?.();
  }, [chatEnabled, handleSend, initialMessage, onInitialMessageSent, conversationData.sending]);

  const currentConversation = activeConversation
    ? conversations.find((conversation) => conversation.id === activeConversation)
    : undefined;
  const lockedAgent = currentConversation?.lockedAgent || null;
  const routingMode = currentConversation?.routingMode || 'auto';
  const title = currentConversation?.title || (activeConversation ? 'Conversation' : '');

  const agentActions = useChatAgentActions({
    activeConversation,
    routingMode,
    onUpdateConversation,
    setActiveAgent,
  });

  return (
    <ChatAreaView
      activeConversation={activeConversation}
      activeEndpoint={activeEndpoint}
      endpoints={endpoints}
      title={title}
      loading={loading}
      messages={messages}
      streamingId={conversationData.streamingId}
      messagesEndRef={messagesEndRef}
      reactSteps={reactSteps}
      reactRunId={reactRunId}
      decisionTrace={decisionTrace}
      agentRunStatus={agentRunStatus}
      showReactSteps={showReactSteps}
      sending={conversationData.sending}
      agents={agents}
      activeAgent={activeAgent}
      autoRoutedAgent={autoRoutedAgent}
      lockedAgent={lockedAgent}
      routingMode={routingMode}
      onEndpointChange={onEndpointChange}
      onRegenerate={runActions.handleRegenerate}
      onRepair={() => onConnectModel('repair')}
      onLinkClick={onLinkClick}
      onToolApproval={runActions.handleToolApproval}
      onSelectAgent={agentActions.handleSelectAgent}
      onUnlock={agentActions.handleUnlock}
      onStop={runActions.handleStop}
      onSend={handleSend}
      chatEnabled={chatEnabled}
      connectionMode={connectionMode}
      repairEndpoint={repairEndpoint}
      onConnectModel={onConnectModel}
      onSkipOnboarding={onSkipOnboarding}
      onCloseConnection={onCloseConnection}
      onConnectionSuccess={onConnectionSuccess}
      recoverableRuns={recoverableRuns}
      onRecoveryAction={handleRecoveryAction}
    />
  );
}
