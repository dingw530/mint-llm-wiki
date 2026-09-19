import { useState } from 'react';
import { testJevConnection } from '@/services/api';
import type { JevFormState } from './jevForm';

interface JevSettingsCardProps {
  jev: JevFormState;
  onChange: (patch: Partial<JevFormState>) => void;
}

type TestState = 'idle' | 'testing' | 'success' | 'error';

/** 一个带唯一可访问名的开关按钮组。 */
function ToggleRow({
  label,
  help,
  enabled,
  enableLabel,
  disableLabel,
  onToggle,
}: {
  label: string;
  help: string;
  enabled: boolean;
  enableLabel: string;
  disableLabel: string;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <div className="mode-toggle">
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
      <p className="form-help">{help}</p>
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
    <div className="form-group">
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
    <div className="experimental-settings-card">
      <div className="settings-section-intro">
        <h3>Jev（TypeSafe System One）</h3>
        <p className="form-help">
          实验性：把 Agent 路由与记忆门控交给 Jev。默认关闭；Jev 不可用时自动回退原有实现。
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="jevApiUrl">Jev Endpoint</label>
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

      <div className="form-group">
        <label htmlFor="jevApiKey">Jev API Key</label>
        <input
          id="jevApiKey"
          type="password"
          value={jev.apiKey}
          onChange={(event) => onChange({ apiKey: event.target.value })}
          placeholder={jev.apiKeyMasked ? '留空则继续使用已保存的 Key' : '必填'}
          autoComplete="new-password"
        />
        {jev.apiKeyMasked && <p className="form-help">已配置：{jev.apiKeyMasked}</p>}
        <p className="form-help">API Key 会加密保存。留空表示继续使用已保存的 Key。</p>
      </div>

      <div className="form-group">
        <label htmlFor="jevModel">Jev 模型</label>
        <input
          id="jevModel"
          value={jev.model}
          onChange={(event) => onChange({ model: event.target.value })}
          placeholder="jev-latest"
        />
      </div>

      <ToggleRow
        label="Agent 路由"
        help="开启后由 Jev 按语义选择 Agent；低于阈值或调用失败时回退关键词与 LLM 分类。"
        enabled={jev.routingEnabled}
        enableLabel="启用 Jev 路由"
        disableLabel="关闭 Jev 路由"
        onToggle={(next) => onChange({ routingEnabled: next })}
      />

      {jev.routingEnabled && (
        <div className="experimental-settings-card">
          <ThresholdRow
            id="jevRoutingMinConfidence"
            label="Jev 路由置信度"
            help="Jev 的置信度低于该值时不采信，回退到原有路由实现。"
            value={jev.routingMinConfidence}
            onChange={(next) => onChange({ routingMinConfidence: next })}
          />
        </div>
      )}

      <ToggleRow
        label="记忆门控"
        help="开启后由 Jev 判断对话是否值得记忆；Jev 判定跳过时不入队提取，且不会被正则推翻。"
        enabled={jev.memoryEnabled}
        enableLabel="启用 Jev 记忆门控"
        disableLabel="关闭 Jev 记忆门控"
        onToggle={(next) => onChange({ memoryEnabled: next })}
      />

      {jev.memoryEnabled && (
        <div className="experimental-settings-card">
          <ThresholdRow
            id="jevMemoryGateThreshold"
            label="Jev 记忆置信度"
            help="Jev 的 noul 判定低于该值视为不值得记忆。默认偏低，因为漏记的代价高于多记。"
            value={jev.memoryGateThreshold}
            onChange={(next) => onChange({ memoryGateThreshold: next })}
          />
        </div>
      )}

      <p className="form-warning">
        实验性：Jev 以英文为主要训练语言，中文场景的准确率可能下降。调用失败时会静默回退原有实现。
      </p>
    </div>
  );
}
