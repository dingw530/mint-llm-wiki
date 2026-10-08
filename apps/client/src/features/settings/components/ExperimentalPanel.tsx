import { useState } from 'react';
import { testChromaConnection } from '@/services/api';
import SelectField from '@/shared/components/SelectField';
import ExperimentalFeatureCard from './ExperimentalFeatureCard';
import JevSettingsCard from './JevSettingsCard';
import type { JevFormState } from './jevForm';

interface ExperimentalPanelProps {
  vectorStore: 'sqlite' | 'chroma';
  setVectorStore: (value: 'sqlite' | 'chroma') => void;
  chromaUrl: string;
  setChromaUrl: (value: string) => void;
  chromaApiKey: string;
  setChromaApiKey: (value: string) => void;
  chromaApiKeyMasked: string;
  jev: JevFormState;
  onJevChange: (patch: Partial<JevFormState>) => void;
}

/** Renders opt-in settings for experimental integrations. */
export default function ExperimentalPanel({
  vectorStore,
  setVectorStore,
  chromaUrl,
  setChromaUrl,
  chromaApiKey,
  setChromaApiKey,
  chromaApiKeyMasked,
  jev,
  onJevChange,
}: ExperimentalPanelProps) {
  const [chromaTest, setChromaTest] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [chromaTestMessage, setChromaTestMessage] = useState('');
  const handleVectorStoreChange = (value: string): void => {
    if (value === 'sqlite' || value === 'chroma') setVectorStore(value);
  };

  const handleChromaTest = async () => {
    setChromaTest('testing');
    setChromaTestMessage('正在测试连接...');
    try {
      const result = await testChromaConnection({
        url: chromaUrl,
        ...(chromaApiKey ? { apiKey: chromaApiKey } : {}),
      });
      if (!result.success) throw new Error(result.message || 'Chroma Server 连接失败');
      setChromaTest('success');
      setChromaTestMessage(result.message || 'Chroma Server 连接成功');
    } catch (error) {
      setChromaTest('error');
      setChromaTestMessage((error as Error).message);
    }
  };

  return (
    <div className="experimental-panel">
      <div className="settings-section-intro">
        <h3>实验性功能</h3>
        <p className="form-help">
          这些功能仍在验证中，可能需要额外服务，默认不会影响 Mint 的稳定功能。
        </p>
      </div>

      <ExperimentalFeatureCard
        index="01"
        title="Wiki 向量库"
        description="选择 Wiki 的向量检索存储；关键词检索和混合排序保持不变。"
        badge={vectorStore === 'chroma' ? 'Chroma 已选' : 'SQLite-vec 默认'}
        className="chroma-feature-card"
      >
        <div className="experimental-config-rows">
          <div className="experimental-config-row">
            <label htmlFor="vectorStore">存储后端</label>
            <SelectField
              id="vectorStore"
              value={vectorStore}
              onChange={handleVectorStoreChange}
              className="experimental-select"
              options={[
                { value: 'sqlite', label: 'SQLite-vec（默认）' },
                { value: 'chroma', label: 'Chroma（实验性）' },
              ]}
            />
          </div>
        </div>

        {vectorStore === 'chroma' && (
          <div className="experimental-feature-details">
            <div className="experimental-config-row">
              <label htmlFor="chromaUrl">CHROMA SERVER URL</label>
              <div className="connection-test-row">
                <input
                  id="chromaUrl"
                  type="url"
                  value={chromaUrl}
                  onChange={(event) => {
                    setChromaUrl(event.target.value);
                    setChromaTest('idle');
                  }}
                  placeholder="http://127.0.0.1:8000"
                />
                <button
                  type="button"
                  className="btn-secondary connection-test-button"
                  onClick={handleChromaTest}
                  disabled={chromaTest === 'testing'}
                >
                  {chromaTest === 'testing' ? '测试中...' : '测试连接'}
                </button>
              </div>
              {chromaTest !== 'idle' && (
                <p className={`connection-test-result ${chromaTest}`} role="status">
                  {chromaTestMessage}
                </p>
              )}
            </div>
            <div className="experimental-config-row">
              <label htmlFor="chromaApiKey">Chroma API Key</label>
              <input
                id="chromaApiKey"
                type="password"
                value={chromaApiKey}
                onChange={(event) => setChromaApiKey(event.target.value)}
                placeholder={chromaApiKeyMasked ? `已配置：${chromaApiKeyMasked}` : '可选'}
                autoComplete="new-password"
              />
              <p className="form-help">API Key 会加密保存。留空表示继续使用已保存的 Key。</p>
            </div>
            <p className="form-warning">
              请先启动可访问的 Chroma Server，切换后需要重新回填 Wiki 向量。
            </p>
          </div>
        )}
      </ExperimentalFeatureCard>

      <JevSettingsCard jev={jev} onChange={onJevChange} />
    </div>
  );
}
