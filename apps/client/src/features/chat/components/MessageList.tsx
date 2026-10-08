import { RefObject } from 'react';
import MarkdownRenderer, { type MarkdownRendererProps } from '@/shared/components/MarkdownRenderer';
import ReActStep from './ReActStep';
import AppIcon from '@/shared/components/AppIcon';
import AiAvatar from '@/shared/components/AiAvatar';
import type { Message, ReActStep as ReActStepData, ContentSegment } from '@/types';
import { buildPersistedA2uiMessages } from './a2uiProtocol';
import A2uiSegment from './A2uiSegment';

/** 过滤历史消息中同一 Wiki 文件产生的重复来源卡片。 */
function uniqueSourceBlocks(blocks: Message['uiBlocks']): NonNullable<Message['uiBlocks']> {
  const seenFiles = new Set<string>();
  return (blocks || []).filter((block) => {
    if (block.kind !== 'wiki_source_reference' || typeof block.data.file !== 'string') return true;
    const file = block.data.file.trim();
    if (!file || seenFiles.has(file)) return false;
    seenFiles.add(file);
    return true;
  });
}

interface MessageListProps {
  messages: Message[];
  streamingId: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  containerRef?: RefObject<HTMLDivElement | null>;
  onRegenerate?: () => void;
  onRepair?: () => void;
  reactSteps?: ReActStepData[];
  showReactSteps?: boolean;
  reactRunId?: string | null;
  onLinkClick?: MarkdownRendererProps['onLinkClick'];
  onToolApproval?: (approvalId: string, action: 'approve' | 'deny') => void;
}

/** 判断消息是否属于当前正在展示的 ReAct 运行。 */
export function matchesReactRun(message: Message, reactRunId: string | null | undefined): boolean {
  return Boolean(reactRunId && message.runId === reactRunId);
}

export default function MessageList({
  messages,
  streamingId,
  scrollRef,
  containerRef,
  onRegenerate,
  onRepair,
  reactSteps,
  reactRunId,
  showReactSteps = true,
  onLinkClick,
  onToolApproval,
}: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="messages-container" ref={containerRef}>
        <div className="welcome-screen">
          <AppIcon size={80} className="welcome" />
          <h2>Mint</h2>
          <p>Mint · 发送消息开始对话</p>
        </div>
      </div>
    );
  }

  function renderSegments(segments: ContentSegment[], isStreaming: boolean) {
    return (
      <div className="content-segments">
        {segments.map((seg, i) => {
          if (seg.type === 'thinking') {
            return (
              <details key={i} className="thinking-segment" open>
                <summary>思考过程</summary>
                <div className="thinking-segment-content">{seg.content}</div>
              </details>
            );
          }
          if (seg.type === 'tool_call') {
            const statusIcon =
              seg.status === 'running' ? (
                <span className="tool-call-cursor">●</span>
              ) : seg.status === 'approval_required' ? (
                <span className="tool-call-status-approval">!</span>
              ) : seg.status === 'error' ? (
                <span className="tool-call-status-error">✕</span>
              ) : null;
            return (
              <div key={i} className={`tool-call-segment tool-call-${seg.status}`}>
                <div className="tool-call-header">
                  <svg
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ opacity: 0.45, flexShrink: 0 }}
                  >
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                  <span className="tool-call-label">
                    {seg.toolName}
                    {seg.summary && (
                      <span className="tool-call-label-summary">
                        {' '}
                        ·{' '}
                        {seg.summary.length > 80
                          ? `${seg.summary.substring(0, 80)}...`
                          : seg.summary}
                      </span>
                    )}
                    {seg.status === 'done' && seg.duration != null && (
                      <span className="tool-call-label-id">
                        {' '}
                        {(Number(seg.duration) / 1000).toFixed(1)}s
                      </span>
                    )}
                    {seg.status === 'error' && seg.retryCount != null && (
                      <span className="tool-call-label-id"> retry ×{seg.retryCount}</span>
                    )}
                  </span>
                  {statusIcon}
                </div>
                {seg.status === 'approval_required' && (
                  <div className="tool-call-approval">
                    <div className="tool-call-approval-reason">
                      {seg.approvalReason || '此操作需要你的确认'}
                    </div>
                    {seg.approvalId && onToolApproval && (
                      <div className="tool-call-approval-actions">
                        <button
                          type="button"
                          onClick={() => onToolApproval(seg.approvalId!, 'approve')}
                        >
                          批准执行
                        </button>
                        <button
                          type="button"
                          onClick={() => onToolApproval(seg.approvalId!, 'deny')}
                        >
                          拒绝
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {seg.status === 'done' && seg.result != null && (
                  <details className="tool-call-result-details">
                    <summary className="tool-call-result-summary">查看返回数据</summary>
                    <pre className="tool-call-result-body">
                      {seg.result.length > 2000
                        ? seg.result.substring(0, 2000) + '\n...(truncated)'
                        : seg.result}
                    </pre>
                  </details>
                )}
                {seg.status === 'error' && seg.error && (
                  <div className="tool-call-error-body">
                    {seg.error.length > 200 ? seg.error.substring(0, 200) + '...' : seg.error}
                  </div>
                )}
              </div>
            );
          }
          if (seg.type === 'text') {
            return (
              <div key={i} className="text-segment">
                <MarkdownRenderer
                  content={seg.content}
                  onLinkClick={onLinkClick}
                  isStreaming={isStreaming}
                />
              </div>
            );
          }
          if (seg.type === 'a2ui') {
            return <A2uiSegment key={seg.segmentId || i} segment={seg} />;
          }
          return null;
        })}
      </div>
    );
  }

  function getSegments(message: Message): ContentSegment[] {
    if (message.segments && message.segments.length > 0) return message.segments;
    if (message.role !== 'assistant' || !message.uiBlocks?.length) return [];
    const segments: ContentSegment[] = [];
    let cursor = 0;
    uniqueSourceBlocks(message.uiBlocks)
      .slice()
      .sort((left, right) => left.blockIndex - right.blockIndex)
      .forEach((block) => {
        const offset = Math.max(cursor, Math.min(message.content.length, block.textOffset || 0));
        if (offset > cursor)
          segments.push({ type: 'text', content: message.content.slice(cursor, offset) });
        const messagesForBlock = buildPersistedA2uiMessages(block);
        if (messagesForBlock.length > 0) {
          segments.push({
            type: 'a2ui',
            segmentId: `persisted-${block.id}`,
            messages: messagesForBlock as Record<string, unknown>[],
          });
        }
        cursor = offset;
      });
    if (cursor < message.content.length)
      segments.push({ type: 'text', content: message.content.slice(cursor) });
    return segments;
  }

  return (
    <div className="messages-container" ref={containerRef}>
      {messages.map((msg) => {
        const isStreaming = msg.role === 'assistant' && msg.id === streamingId;
        const displaySegments = msg.role === 'assistant' ? getSegments(msg) : [];
        const hasSegments = displaySegments.length > 0;
        return (
          <div key={msg.id || msg._tempId} className="message-wrapper">
            <div className={`message-avatar-wrapper ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'user' ? '你' : msg.role === 'error' ? '!' : <AiAvatar size={32} />}
              </div>
            </div>
            <div className={`message ${msg.role}${isStreaming ? ' streaming' : ''}`}>
              <div className="message-label">
                {msg.role === 'user' ? '你' : msg.role === 'error' ? '错误' : 'AI'}
              </div>
              {msg.role === 'assistant' && hasSegments ? (
                <>{renderSegments(displaySegments, isStreaming)}</>
              ) : (
                <>
                  {msg.reasoning && (
                    <details className="reasoning-block" open>
                      <summary>思考过程</summary>
                      <div className="reasoning-content">{msg.reasoning}</div>
                    </details>
                  )}
                  {showReactSteps &&
                  msg.role === 'assistant' &&
                  matchesReactRun(msg, reactRunId) &&
                  reactSteps &&
                  reactSteps.length > 0 ? (
                    <div className="react-steps-container">
                      {reactSteps.map((step, i) => (
                        <ReActStep
                          key={i}
                          step={step}
                          isLast={isStreaming && i === reactSteps.length - 1}
                        />
                      ))}
                    </div>
                  ) : null}
                  {msg.role === 'assistant' ? (
                    <MarkdownRenderer
                      content={msg.content}
                      onLinkClick={onLinkClick}
                      isStreaming={isStreaming}
                    />
                  ) : (
                    <span>{msg.content}</span>
                  )}
                </>
              )}
              {msg.role === 'error' && (
                <div className="message-error-actions">
                  {(msg.errorCategory === 'retryable' || msg.errorCategory === 'unknown') &&
                    onRegenerate && (
                      <button className="btn-secondary" onClick={onRegenerate}>
                        重试
                      </button>
                    )}
                  {(msg.errorCategory === 'configuration' || msg.errorCategory === 'unknown') &&
                    onRepair && (
                      <button className="btn-secondary" onClick={onRepair}>
                        检查连接配置
                      </button>
                    )}
                </div>
              )}
              {msg.role === 'assistant' && msg.tokenUsage != null && !isStreaming && (
                <div className="message-token-usage">
                  本次运行 {msg.tokenUsage.totalTokens.toLocaleString()} tokens（输入{' '}
                  {msg.tokenUsage.inputTokens.toLocaleString()} · 输出{' '}
                  {msg.tokenUsage.outputTokens.toLocaleString()}）
                </div>
              )}
              {msg.role === 'assistant' &&
                msg.tokenUsage == null &&
                msg.estimatedTokens != null &&
                !isStreaming && (
                  <div className="message-token-usage">
                    本轮约 {msg.estimatedTokens.toLocaleString()} tokens
                  </div>
                )}
              {isStreaming && <span className="cursor" />}
              {msg.role === 'assistant' &&
                !isStreaming &&
                onRegenerate &&
                messages.indexOf(msg) === messages.length - 1 && (
                  <button
                    className="regenerate-btn"
                    title="重新生成"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRegenerate();
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                )}
            </div>
          </div>
        );
      })}
      <div ref={scrollRef} />
    </div>
  );
}
