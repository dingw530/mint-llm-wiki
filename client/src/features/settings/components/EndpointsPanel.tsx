import { useState, useEffect, useCallback } from 'react';
import SelectField from '@/shared/components/SelectField';
import {
  getEndpoints,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  activateEndpoint,
} from '@/services/api';
import type { EndpointOutput, EndpointInput } from '@/types';

const emptyForm: EndpointInput & { apiType: string } = {
  name: '',
  apiUrl: '',
  apiKey: '',
  modelId: '',
  apiType: 'openai-chat',
};

const API_TYPE_LABELS: Record<string, string> = {
  'openai-chat': 'OpenAI Chat',
  anthropic: 'Anthropic API',
  'openai-responses': 'OpenAI Responses',
};

function DetailModal({ endpoint, onClose }: { endpoint: EndpointOutput; onClose: () => void }) {
  if (!endpoint) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="ep-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ep-detail-header">
          <div className="ep-detail-title-row">
            <span className="ep-detail-name">{endpoint.name}</span>
            {endpoint.isActive && <span className="endpoint-active-badge">当前使用</span>}
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="ep-detail-body">
          <dl className="ep-detail-grid">
            <div className="ep-detail-field">
              <dt>API 类型</dt>
              <dd>{API_TYPE_LABELS[endpoint.apiType] || endpoint.apiType || 'OpenAI Chat'}</dd>
            </div>
            <div className="ep-detail-field">
              <dt>API URL</dt>
              <dd className="ep-detail-url">{endpoint.apiUrl}</dd>
            </div>
            <div className="ep-detail-field">
              <dt>模型 ID</dt>
              <dd>{endpoint.modelId}</dd>
            </div>
            <div className="ep-detail-field">
              <dt>API Key</dt>
              <dd className="ep-detail-masked">{endpoint.apiKeyMasked || '未设置'}</dd>
            </div>
            <div className="ep-detail-field">
              <dt>端点 ID</dt>
              <dd className="ep-detail-id">{endpoint.id}</dd>
            </div>
          </dl>
        </div>
        <div
          className="modal-actions"
          style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)' }}
        >
          <button className="btn-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

interface EndpointsPanelProps {
  onToast?: (type: 'success' | 'error', message: string) => void;
}

export default function EndpointsPanel({ onToast }: EndpointsPanelProps) {
  const [endpoints, setEndpoints] = useState<EndpointOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EndpointOutput | null>(null);
  const [detailTarget, setDetailTarget] = useState<EndpointOutput | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getEndpoints()
      .then((data) => setEndpoints(data.endpoints || []))
      .catch((err) => onToast && onToast('error', `加载端点失败: ${(err as Error).message}`))
      .finally(() => setLoading(false));
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setEditingId('__new__');
    setForm({ ...emptyForm });
  };

  const openEdit = (ep: EndpointOutput) => {
    setEditingId(ep.id);
    setForm({
      name: ep.name,
      apiUrl: ep.apiUrl,
      apiKey: '',
      modelId: ep.modelId,
      apiType: ep.apiType || 'openai-chat',
    });
  };

  const openCopy = (ep: EndpointOutput) => {
    setEditingId('__new__');
    setForm({
      name: ep.name + ' (副本)',
      apiUrl: ep.apiUrl,
      apiKey: '',
      modelId: ep.modelId,
      apiType: ep.apiType || 'openai-chat',
    });
  };

  const closeForm = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.apiUrl.trim() || !form.modelId.trim()) {
      onToast && onToast('error', '名称、API URL 和 Model ID 不能为空');
      return;
    }
    setSaving(true);
    try {
      if (editingId === '__new__') {
        await createEndpoint(form);
        onToast && onToast('success', '端点已创建');
      } else {
        await updateEndpoint(editingId as string, form);
        onToast && onToast('success', '端点已更新');
      }
      closeForm();
      load();
    } catch (err) {
      onToast && onToast('error', `保存失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deleteEndpoint(deleteTarget.id);
      onToast && onToast('success', '端点已删除');
      setDeleteTarget(null);
      load();
    } catch (err) {
      onToast && onToast('error', `删除失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (id: string) => {
    try {
      await activateEndpoint(id);
      load();
    } catch (err) {
      onToast && onToast('error', `激活失败: ${(err as Error).message}`);
    }
  };

  if (loading)
    return (
      <div className="skeleton-panel">
        <div className="skeleton skeleton-panel-header" />
        <div className="skeleton skeleton-panel-row" />
        <div className="skeleton skeleton-panel-row" />
        <div className="skeleton skeleton-panel-row short" />
      </div>
    );

  return (
    <div className="endpoints-panel">
      <div
        className="panel-header"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
          共 {endpoints.length} 个端点配置
        </span>
        <button className="btn-primary" onClick={openAdd}>
          + 新增端点
        </button>
      </div>

      {endpoints.length === 0 ? (
        <div className="panel-empty">尚未配置任何端点，点击"新增端点"开始配置。</div>
      ) : (
        <table className="mcp-table">
          <thead>
            <tr>
              <th>端点名称</th>
              <th>模型 ID</th>
              <th>状态</th>
              <th style={{ width: 160 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((ep) => (
              <tr key={ep.id}>
                <td className="mcp-name">{ep.name}</td>
                <td>
                  <code className="ep-table-model">{ep.modelId}</code>
                </td>
                <td>
                  {ep.isActive ? (
                    <span className="endpoint-active-badge">当前使用</span>
                  ) : (
                    <button
                      className="btn-secondary"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => handleActivate(ep.id)}
                    >
                      设为当前
                    </button>
                  )}
                </td>
                <td>
                  <div className="mcp-actions" style={{ display: 'flex', gap: 2 }}>
                    <button className="btn-icon" title="详情" onClick={() => setDetailTarget(ep)}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3zM2 8a6 6 0 1 1 12 0A6 6 0 0 1 2 8z" />
                        <circle cx="8" cy="8" r="1.5" />
                        <path d="M7.5 6.5h1v4h-1v-4z" />
                      </svg>
                    </button>
                    <button className="btn-icon" title="编辑" onClick={() => openEdit(ep)}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 2.793L10.5 3 4 9.5 3.1 11.9l2.4-.9 6.293-6.607z" />
                      </svg>
                    </button>
                    <button className="btn-icon" title="复制" onClick={() => openCopy(ep)}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4 1.5C4 1.224 4.224 1 4.5 1h6.793l3.207 3.207V14.5a.5.5 0 0 1-.5.5H4.5a.5.5 0 0 1-.5-.5v-13zM5 2v12h8V4.707L11.293 3H5z" />
                        <path d="M1.5 3a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5H11a.5.5 0 0 0 0 1H1.5A1.5 1.5 0 0 1 0 14.5v-11A1.5 1.5 0 0 1 1.5 2H9a.5.5 0 0 1 0 1H1.5z" />
                      </svg>
                    </button>
                    <button
                      className="btn-icon btn-icon-danger"
                      title="删除"
                      onClick={() => setDeleteTarget(ep)}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                        <path
                          fillRule="evenodd"
                          d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
                        />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detailTarget && (
        <DetailModal endpoint={detailTarget} onClose={() => setDetailTarget(null)} />
      )}

      {editingId && (
        <div className="modal-overlay">
          <div className="tool-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tool-modal-header">
              <h3>{editingId === '__new__' ? '新增端点' : '编辑端点'}</h3>
              <button className="modal-close-btn" onClick={closeForm}>
                ×
              </button>
            </div>
            <div className="tool-modal-body" style={{ padding: '16px 20px' }}>
              <div className="form-group">
                <label htmlFor="epName">端点名称 *</label>
                <input
                  id="epName"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如 OpenAI GPT-4o"
                  maxLength={50}
                />
              </div>
              <div className="form-group">
                <label htmlFor="epUrl">API URL *</label>
                <input
                  id="epUrl"
                  type="text"
                  value={form.apiUrl}
                  onChange={(e) => setForm({ ...form, apiUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </div>
              <div className="form-group">
                <label htmlFor="epType">API 类型</label>
                <SelectField
                  id="epType"
                  options={[
                    { value: 'openai-chat', label: 'OpenAI Chat Completions' },
                    { value: 'anthropic', label: 'Anthropic Messages API' },
                    { value: 'openai-responses', label: 'OpenAI Responses API' },
                  ]}
                  value={form.apiType}
                  onChange={(v) => setForm({ ...form, apiType: v })}
                />
                <p className="form-help">选择 API 类型后，服务端会自动适配请求格式和响应解析。</p>
              </div>
              <div className="form-group">
                <label htmlFor="epKey">
                  API Key{' '}
                  <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(选填)</span>
                </label>
                <input
                  id="epKey"
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder={editingId === '__new__' ? '留空则不设置' : '留空则保留原 Key'}
                />
              </div>
              <div className="form-group">
                <label htmlFor="epModel">模型 ID *</label>
                <input
                  id="epModel"
                  type="text"
                  value={form.modelId}
                  onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                  placeholder="gpt-4o-mini"
                />
              </div>
            </div>
            <div
              className="modal-actions"
              style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)' }}
            >
              <button className="btn-secondary" onClick={closeForm}>
                取消
              </button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="tool-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tool-modal-header">
              <h3>确认删除</h3>
              <button className="modal-close-btn" onClick={() => setDeleteTarget(null)}>
                ×
              </button>
            </div>
            <div className="tool-modal-body" style={{ padding: '16px 20px' }}>
              <p>
                删除后不可恢复，确定删除端点 <strong>{deleteTarget.name}</strong>？
              </p>
            </div>
            <div
              className="modal-actions"
              style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)' }}
            >
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button
                className="btn-primary"
                onClick={handleDelete}
                disabled={saving}
                style={{ background: 'var(--error-text)', borderColor: 'var(--error-text)' }}
              >
                {saving ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
