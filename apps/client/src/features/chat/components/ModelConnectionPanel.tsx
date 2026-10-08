import { useEffect, useState } from 'react';
import { listEndpointModels, testEndpointConnection } from '@/services/api';
import type { EndpointOutput } from '@/types';
import type { ModelConnectionInput } from '@/services/api/endpoints';
import {
  recordModelConnectionEvent,
  recordModelConnectionEventOnce,
} from '../modelConnectionEvents';

interface ModelConnectionPanelProps {
  endpoint?: EndpointOutput | null;
  onboarding?: boolean;
  onClose?: () => void;
  onSkip?: () => void;
  onSuccess: (endpoint: EndpointOutput) => void;
}

type FormState = Omit<ModelConnectionInput, 'endpointId'> & { name: string };

const API_TYPES = [
  { value: 'openai-chat', label: 'Chat Completions' },
  { value: 'openai-responses', label: 'Responses' },
  { value: 'anthropic', label: 'Anthropic Messages' },
];

function initialForm(endpoint?: EndpointOutput | null): FormState {
  return {
    name: endpoint?.name || '自定义模型',
    apiUrl: endpoint?.apiUrl || '',
    apiKey: '',
    modelId: endpoint?.modelId || '',
    apiType: endpoint?.apiType || 'openai-chat',
  };
}

/** Shared first-use, repair, and settings model connection form. */
export default function ModelConnectionPanel({
  endpoint,
  onboarding = false,
  onClose,
  onSkip,
  onSuccess,
}: ModelConnectionPanelProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(endpoint));
  const [models, setModels] = useState<string[]>([]);
  const [modelListAvailable, setModelListAvailable] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<{ category?: string; message: string } | null>(null);
  const [startedAt] = useState(() => Date.now());
  const { apiKey, apiType, apiUrl } = form;

  useEffect(() => {
    if (!apiUrl.trim()) return undefined;
    const timer = window.setTimeout(async () => {
      setLoadingModels(true);
      try {
        const result = await listEndpointModels({ apiKey, apiType, apiUrl, modelId: '' });
        setModels(result.models);
        setModelListAvailable(result.available);
        recordModelConnectionEvent(result.available ? 'model_list_loaded' : 'model_list_failed');
      } catch {
        setModels([]);
        setModelListAvailable(false);
        recordModelConnectionEvent('model_list_failed');
      } finally {
        setLoadingModels(false);
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [apiKey, apiType, apiUrl]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setError(null);
  };

  const handleTest = async (): Promise<void> => {
    if (!form.name.trim() || !form.apiUrl.trim() || !form.modelId.trim()) {
      setError({ message: '请填写名称、API URL 和模型。' });
      return;
    }
    setTesting(true);
    setError(null);
    recordModelConnectionEvent('connection_test_started');
    try {
      const result = await testEndpointConnection({
        ...form,
        ...(endpoint ? { endpointId: endpoint.id } : {}),
      });
      if (!result.success || !result.endpoint) {
        const category = result.errorCategory || 'unknown';
        setError({ category, message: result.errorMessage || '连接失败，请检查配置或重试。' });
        recordModelConnectionEvent('connection_test_failed', { errorCategory: category });
        return;
      }
      recordModelConnectionEvent('connection_test_succeeded', {
        elapsedMs: Date.now() - startedAt,
      });
      recordModelConnectionEventOnce('first_use_onboarding_shown');
      setSuccess(true);
      window.setTimeout(() => onSuccess(result.endpoint!), 350);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '连接失败，请重试。';
      setError({ category: 'unknown', message });
      recordModelConnectionEvent('connection_test_failed', { errorCategory: 'unknown' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="model-connection-backdrop">
      <section className="model-connection-panel" aria-labelledby="model-connection-title">
        <div className="model-connection-header">
          <div>
            <span className="model-connection-kicker">{onboarding ? '首次使用' : '模型连接'}</span>
            <h2 id="model-connection-title">连接模型</h2>
            <p>
              {onboarding
                ? '连接一个模型后即可开始对话。你也可以先跳过，之后从 Chat 内继续。'
                : '更新配置后进行一次真实请求，成功才会保存为可用连接。'}
            </p>
          </div>
          {!onboarding && onClose && (
            <button className="modal-close-btn" onClick={onClose} aria-label="关闭">
              ×
            </button>
          )}
        </div>

        <div className="model-connection-form">
          <div className="model-connection-grid">
            <label className="form-group">
              <span>名称</span>
              <input
                aria-label="名称"
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
              />
            </label>
            <label className="form-group model-connection-url">
              <span>API URL</span>
              <input
                aria-label="API URL"
                value={form.apiUrl}
                onChange={(event) => update('apiUrl', event.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </label>
          </div>
          <div className="model-connection-grid">
            <label className="form-group">
              <span>API 类型</span>
              <select
                aria-label="API 类型"
                value={form.apiType}
                onChange={(event) => update('apiType', event.target.value)}
              >
                {API_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-group">
              <span>
                API Key <small>（可选）</small>
              </span>
              <input
                aria-label="API Key"
                type="password"
                value={form.apiKey}
                onChange={(event) => update('apiKey', event.target.value)}
                placeholder={endpoint ? '留空则保留原 Key' : '无 Key 的本地模型可留空'}
              />
            </label>
          </div>
          <label className="form-group">
            <span>模型</span>
            <input
              aria-label="模型"
              list="model-connection-options"
              value={form.modelId}
              onChange={(event) => update('modelId', event.target.value)}
              placeholder="输入模型 ID"
            />
            <datalist id="model-connection-options">
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <small className="model-connection-help">
              {loadingModels
                ? '正在获取模型列表…'
                : modelListAvailable
                  ? '已获取可选模型，也可以自由输入。'
                  : '暂时无法获取列表，请直接输入模型 ID。'}
            </small>
          </label>

          {success && (
            <div className="model-connection-success" role="status">
              连接成功
            </div>
          )}
          {error && !success && (
            <div className="model-connection-error" role="alert">
              <span>{error.message}</span>
              {error.category === 'configuration' && <strong>请修正配置后重新测试。</strong>}
              {error.category === 'retryable' && <strong>网络问题可直接重试。</strong>}
            </div>
          )}
        </div>

        <div className="model-connection-footer">
          {onboarding && onSkip && (
            <button className="btn-secondary" onClick={onSkip}>
              跳过
            </button>
          )}
          {!onboarding && onClose && (
            <button className="btn-secondary" onClick={onClose}>
              取消
            </button>
          )}
          <button className="btn-primary" onClick={handleTest} disabled={testing}>
            {testing ? '测试中…' : '测试连接'}
          </button>
        </div>
      </section>
    </div>
  );
}
