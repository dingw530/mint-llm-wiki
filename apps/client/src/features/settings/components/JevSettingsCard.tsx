import { useState } from 'react';
import { testJevConnection } from '@/services/api';
import ExperimentalFeatureCard from './ExperimentalFeatureCard';
import type { JevFormState } from './jevForm';

interface JevSettingsCardProps {
  jev: JevFormState;
  onChange: (patch: Partial<JevFormState>) => void;
}

type TestState = 'idle' | 'testing' | 'success' | 'error';

/** 一个带唯一可访问名的开关按钮组。 */
function ToggleRow({
  enabled,
  enableLabel,
  disableLabel,
  onToggle,
}: {
  enabled: boolean;
  enableLabel: string;
  disableLabel: string;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="mode-toggle jev-mode-toggle">
      <button
        type="button"
        className={enabled ? 'active' : ''}
        aria-label={enableLabel}
        onClick={() => onToggle(true)}
      >
        启用
      </button>
      <button
        type="button"
        className={!enabled ? 'active' : ''}
        aria-label={disableLabel}
        onClick={() => onToggle(false)}
      >
        关闭
      </button>
    </div>
  );
}

/** 0~1 区间的阈值输入；`NumberInput` 只支持整数，因此这里用原生 number 输入。 */
function ThresholdRow({
  id,
  label,
  help,
  value,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="jev-threshold-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min="0"
        max="1"
        step="0.05"
        value={value}
        onChange={(event) => {
          const parsed = Number.parseFloat(event.target.value);
          if (Number.isFinite(parsed)) onChange(Math.min(1, Math.max(0, parsed)));
        }}
      />
      <p className="form-help">{help}</p>
    </div>
  );
}

/** Jev（TypeSafe System One）实验功能的配置卡片。 */
export default function JevSettingsCard({ jev, onChange }: JevSettingsCardProps) {
  const [test, setTest] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState('');

  const handleTest = async () => {
    setTest('testing');
    setTestMessage('正在测试连接...');
    try {
      const result = await testJevConnection({
        apiUrl: jev.apiUrl.trim(),
        model: jev.model.trim(),
        ...(jev.apiKey ? { apiKey: jev.apiKey } : {}),
      });
      setTest(result.success ? 'success' : 'error');
      setTestMessage(result.message);
    } catch (error) {
      setTest('error');
      setTestMessage((error as Error).message);
    }
  };

  return (
    <ExperimentalFeatureCard
      index="02"
      title="Jev 实验能力"
      description="为 Mint 增加可回退的语义能力。每项能力独立启用，Jev 不可用时自动回退原有实现。"
      className="jev-feature-card"
    >
      <section className="jev-config-section" aria-labelledby="jev-connection-title">
        <div className="jev-subsection-bar">
          <h4 id="jev-connection-title">连接配置</h4>
          <p>先配置 Jev 服务，下面的能力开关共用这组连接。</p>
        </div>

        <div className="jev-config-rows">
          <div className="jev-config-row">
            <label htmlFor="jevApiUrl">JEV ENDPOINT</label>
            <div className="connection-test-row">
              <input
                id="jevApiUrl"
                type="url"
                value={jev.apiUrl}
                onChange={(event) => {
                  onChange({ apiUrl: event.target.value });
                  setTest('idle');
                }}
                placeholder="https://api.typesafe.ai/v1/systemone"
              />
              <button
                type="button"
                className="btn-secondary connection-test-button"
                aria-label="测试 Jev 连接"
                onClick={handleTest}
                disabled={test === 'testing'}
              >
                {test === 'testing' ? '测试中...' : '测试连接'}
              </button>
            </div>
            {test !== 'idle' && (
              <p className={`connection-test-result ${test}`} role="status">
                {testMessage}
              </p>
            )}
          </div>

          <div className="jev-config-row jev-config-pair">
            <label htmlFor="jevModel">模型</label>
            <input
              id="jevModel"
              value={jev.model}
              onChange={(event) => onChange({ model: event.target.value })}
              placeholder="jev-latest"
            />
            <label htmlFor="jevApiKey">API KEY</label>
            <div className="jev-config-field">
              <input
                id="jevApiKey"
                type="password"
                value={jev.apiKey}
                onChange={(event) => onChange({ apiKey: event.target.value })}
                placeholder={jev.apiKeyMasked ? '留空则继续使用已保存的 Key' : '必填'}
                autoComplete="new-password"
              />
              {jev.apiKeyMasked && <p className="form-help">已配置：{jev.apiKeyMasked}</p>}
            </div>
          </div>
        </div>
        <p className="jev-config-note">API Key 会加密保存。留空表示继续使用已保存的 Key。</p>
      </section>

      <section className="jev-capabilities-section" aria-labelledby="jev-capabilities-title">
        <div className="jev-subsection-bar">
          <h4 id="jev-capabilities-title">语义能力</h4>
          <p>按需打开单项实验能力；关闭后完全沿用 Mint 原有逻辑。</p>
        </div>

        <div className="jev-capability-list">
          <article className={`jev-capability ${jev.routingEnabled ? 'is-enabled' : ''}`}>
            <div className="jev-capability-row">
              <div className="jev-capability-copy">
                <h5>Agent 路由</h5>
                <p>让 Jev 按语义选择最合适的 Agent。</p>
              </div>
              <ToggleRow
                enabled={jev.routingEnabled}
                enableLabel="启用 Jev 路由"
                disableLabel="关闭 Jev 路由"
                onToggle={(next) => onChange({ routingEnabled: next })}
              />
              {jev.routingEnabled && (
                <div className="jev-capability-threshold">
                  <ThresholdRow
                    id="jevRoutingMinConfidence"
                    label="路由置信度阈值"
                    help="低于该值时不采信 Jev 结果。"
                    value={jev.routingMinConfidence}
                    onChange={(next) => onChange({ routingMinConfidence: next })}
                  />
                </div>
              )}
            </div>
          </article>

          <article className={`jev-capability ${jev.memoryEnabled ? 'is-enabled' : ''}`}>
            <div className="jev-capability-row">
              <div className="jev-capability-copy">
                <h5>记忆门控</h5>
                <p>让 Jev 判断当前对话是否值得写入长期记忆。</p>
              </div>
              <ToggleRow
                enabled={jev.memoryEnabled}
                enableLabel="启用 Jev 记忆门控"
                disableLabel="关闭 Jev 记忆门控"
                onToggle={(next) => onChange({ memoryEnabled: next })}
              />
              {jev.memoryEnabled && (
                <div className="jev-capability-threshold">
                  <ThresholdRow
                    id="jevMemoryGateThreshold"
                    label="记忆置信度阈值"
                    help="低于该值视为不值得记忆。"
                    value={jev.memoryGateThreshold}
                    onChange={(next) => onChange({ memoryGateThreshold: next })}
                  />
                </div>
              )}
            </div>
          </article>

          <article className={`jev-capability ${jev.rerankEnabled ? 'is-enabled' : ''}`}>
            <div className="jev-capability-row">
              <div className="jev-capability-copy">
                <h5>Wiki 语义 Rerank</h5>
                <p>对召回的 Wiki 候选执行 Jev 语义重排。</p>
              </div>
              <ToggleRow
                enabled={jev.rerankEnabled}
                enableLabel="启用 Jev Wiki rerank"
                disableLabel="关闭 Jev Wiki rerank"
                onToggle={(next) => onChange({ rerankEnabled: next })}
              />
            </div>
          </article>
        </div>
      </section>

      <footer className="jev-settings-footer">
        <span className="jev-footer-mark">!</span>
        <p>Jev 以英文为主要训练语言，中文场景的准确率可能下降。实验失败时会静默回退原有实现。</p>
      </footer>
    </ExperimentalFeatureCard>
  );
}
