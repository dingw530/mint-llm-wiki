import { useRef, useState } from 'react';
import type { RecoverableAgentRun, RecoveryAction } from '@/services/api/agentRunRecovery';

interface RecoveryCardsProps {
  runs: RecoverableAgentRun[];
  onResolve: (
    runId: string,
    action: RecoveryAction,
    confirmation: boolean,
    idempotencyKey: string,
  ) => Promise<void>;
}

/** Displays durable interrupted-run facts and requires explicit retry confirmation. */
export default function RecoveryCards({ runs, onResolve }: RecoveryCardsProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionKeys = useRef(new Map<string, string>());
  const resolvingRuns = useRef(new Set<string>());

  async function resolve(runId: string, action: RecoveryAction, confirmation = false) {
    if (resolvingRuns.current.has(runId)) return;
    resolvingRuns.current.add(runId);
    setPending(`${runId}:${action}`);
    setError(null);
    try {
      const key = `${runId}:${action}`;
      const idempotencyKey = actionKeys.current.get(key) || crypto.randomUUID();
      actionKeys.current.set(key, idempotencyKey);
      await onResolve(runId, action, confirmation, idempotencyKey);
      setConfirming(null);
    } catch (reason) {
      resolvingRuns.current.delete(runId);
      setError(reason instanceof Error ? reason.message : '恢复操作失败');
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="agent-run-recovery-cards" aria-label="可恢复运行">
      {runs.map((run) => (
        <article className="agent-run-recovery-card" key={run.runId}>
          <div className="agent-run-recovery-card__header">
            <span className="agent-run-recovery-card__icon" aria-hidden="true">
              !
            </span>
            <div>
              <strong>运行已中断</strong>
              <p>这次运行在完成前意外停止。</p>
            </div>
          </div>
          {run.unknownTools.length > 0 && (
            <p className="agent-run-recovery-card__warning">
              {run.unknownTools.some((tool) => tool.ledgerStatus === 'succeeded')
                ? '工具账本记录执行成功，但原结果未保存。继续时会先核对外部状态，不会重试已成功的调用。'
                : run.unknownTools.some((tool) => !tool.argumentsAvailable)
                  ? '原始参数未恢复，无法安全重试。继续运行会先确认目标或核对实际状态。'
                  : '工具结果未知，不会自动重放。'}
            </p>
          )}
          {confirming === run.runId ? (
            <div className="agent-run-recovery-card__confirmation">
              <p>这会创建新的运行。先确认旧工具调用的实际状态，再决定后续操作。</p>
              <button
                className="btn-primary"
                type="button"
                onClick={() => resolve(run.runId, 'retry', true)}
                disabled={pending !== null}
              >
                确认重试
              </button>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => setConfirming(null)}
                disabled={pending !== null}
              >
                取消
              </button>
            </div>
          ) : (
            <div className="agent-run-recovery-card__actions">
              {run.actions.includes('continue') && (
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => resolve(run.runId, 'continue')}
                  disabled={pending !== null}
                >
                  继续运行
                </button>
              )}
              {run.actions.includes('retry') && (
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => setConfirming(run.runId)}
                  disabled={pending !== null}
                >
                  重试运行
                </button>
              )}
              <button
                className="agent-run-recovery-card__abandon"
                type="button"
                onClick={() => resolve(run.runId, 'abandon')}
                disabled={pending !== null}
              >
                放弃运行
              </button>
            </div>
          )}
          {error && (
            <p className="agent-run-recovery-card__error" role="alert">
              {error}
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
