import type { RefObject } from 'react';
import MessageList from './MessageList';
import InputBox from './InputBox';
import AgentBar from './AgentBar';
import ChatHeader from './ChatHeader';
import DecisionTrace from './DecisionTrace';
import AgentRunStatus, { type AgentRunStatusData } from './AgentRunStatus';
import IngestionTaskCards from './IngestionTaskCards';
import ModelSwitcher from '@/shared/components/ModelSwitcher';
import type { MarkdownRendererProps } from '@/shared/components/MarkdownRenderer';
import type { Agent, DecisionTraceItem, EndpointOutput, Message, ReActStep } from '@/types';
import ModelConnectionPanel from './ModelConnectionPanel';
import RecoveryCards from './RecoveryCards';
import type { RecoverableAgentRun, RecoveryAction } from '@/services/api/agentRunRecovery';

function LoadingSpinner() {
  return (
    <div className="loading-spinner">
      <span />
      <span />
      <span />
    </div>
  );
}

export interface ChatAreaViewProps {
  activeConversation: string | null;
  activeEndpoint: EndpointOutput | null;
  endpoints: EndpointOutput[];
  title: string;
  loading: boolean;
  messages: Message[];
  streamingId: string | null;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  reactSteps: ReActStep[];
  reactRunId: string | null;
  decisionTrace: DecisionTraceItem[];
  agentRunStatus: AgentRunStatusData | null;
  showReactSteps: boolean;
  sending: boolean;
  agents: Agent[];
  activeAgent: string;
  autoRoutedAgent: string | null;
  lockedAgent: string | null;
  routingMode: string;
  onEndpointChange: () => Promise<void>;
  onRegenerate: () => void;
  onRepair?: () => void;
  onLinkClick?: MarkdownRendererProps['onLinkClick'];
  onToolApproval: (approvalId: string, action: 'approve' | 'deny') => void;
  onSelectAgent: (agentId: string) => void;
  onUnlock: () => void;
  onStop: () => void;
  onSend: (content: string) => void;
  chatEnabled: boolean;
  connectionMode: 'onboarding' | 'repair' | null;
  repairEndpoint: EndpointOutput | null;
  onConnectModel: (mode?: 'onboarding' | 'repair') => void;
  onSkipOnboarding: () => void;
  onCloseConnection: () => void;
  onConnectionSuccess: (endpoint: EndpointOutput) => Promise<void>;
  recoverableRuns: RecoverableAgentRun[];
  onRecoveryAction: (
    runId: string,
    action: RecoveryAction,
    confirmation: boolean,
    idempotencyKey: string,
  ) => Promise<void>;
}

/**
 * ChatArea 的纯视图层，只负责布局和将交互回调传给子组件。
 * @param props 聊天运行时状态与动作
 * @returns 聊天页面视图
 */
export default function ChatAreaView({
  activeConversation,
  activeEndpoint,
  endpoints,
  title,
  loading,
  messages,
  streamingId,
  messagesEndRef,
  reactSteps,
  reactRunId,
  decisionTrace,
  agentRunStatus,
  showReactSteps,
  sending,
  agents,
  activeAgent,
  autoRoutedAgent,
  lockedAgent,
  routingMode,
  onEndpointChange,
  onRegenerate,
  onRepair,
  onLinkClick,
  onToolApproval,
  onSelectAgent,
  onUnlock,
  onStop,
  onSend,
  chatEnabled,
  connectionMode,
  repairEndpoint,
  onConnectModel,
  onSkipOnboarding,
  onCloseConnection,
  onConnectionSuccess,
  recoverableRuns,
  onRecoveryAction,
}: ChatAreaViewProps) {
  return (
    <div className="main-area">
      <ChatHeader title={title} />
      <div className="chat-area">
        {showReactSteps && (decisionTrace.length > 0 || agentRunStatus) && (
          <div className="chat-top-status">
            {agentRunStatus && <AgentRunStatus status={agentRunStatus} />}
            {decisionTrace.length > 0 && <DecisionTrace items={decisionTrace} />}
          </div>
        )}
        {!chatEnabled && messages.length === 0 && !connectionMode && (
          <div className="chat-model-gate">
            <div className="chat-model-gate-icon">✦</div>
            <h2>连接模型后开始对话</h2>
            <p>当前 Chat 暂不可用，先连接一个可验证的模型端点。</p>
            <button className="btn-primary" onClick={() => onConnectModel('repair')}>
              连接模型
            </button>
          </div>
        )}
        {activeConversation && recoverableRuns.length > 0 && (
          <RecoveryCards runs={recoverableRuns} onResolve={onRecoveryAction} />
        )}
        {loading ? (
          <div className="messages-loading">
            <LoadingSpinner />
          </div>
        ) : (
          <MessageList
            messages={messages}
            streamingId={streamingId}
            scrollRef={messagesEndRef}
            onRegenerate={onRegenerate}
            onRepair={onRepair}
            reactSteps={reactSteps}
            reactRunId={reactRunId}
            showReactSteps={showReactSteps}
            onLinkClick={onLinkClick}
            onToolApproval={onToolApproval}
          />
        )}
        <div className="chat-composer">
          <div className="chat-input-zone">
            <IngestionTaskCards conversationId={activeConversation} />
            <div className="chat-input-row">
              <div className="chat-input-main">
                {sending ? (
                  <button className="stop-btn" onClick={onStop}>
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                    </svg>
                    停止生成
                  </button>
                ) : (
                  <InputBox onSend={onSend} disabled={sending || !chatEnabled}>
                    <AgentBar
                      agents={agents}
                      activeAgent={activeAgent}
                      autoRoutedAgent={autoRoutedAgent}
                      lockedAgent={lockedAgent}
                      routingMode={routingMode}
                      onSelectAgent={onSelectAgent}
                      onUnlock={onUnlock}
                    />
                    <ModelSwitcher
                      activeEndpoint={activeEndpoint}
                      endpoints={endpoints}
                      onEndpointChange={onEndpointChange}
                    />
                  </InputBox>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {connectionMode && (
        <ModelConnectionPanel
          endpoint={repairEndpoint}
          onboarding={connectionMode === 'onboarding'}
          onClose={connectionMode === 'repair' ? onCloseConnection : undefined}
          onSkip={connectionMode === 'onboarding' ? onSkipOnboarding : undefined}
          onSuccess={onConnectionSuccess}
        />
      )}
    </div>
  );
}
