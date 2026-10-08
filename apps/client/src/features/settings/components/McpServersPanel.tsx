import { useState, useEffect, useCallback } from 'react';
import { getMcpServers, createMcpServer, updateMcpServer, deleteMcpServer, restartMcpServer } from '@/services/api';
import type { McpServer } from '@/types';

const JSON_TEMPLATE = `{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      "env": {
        "API_KEY": "your-key-here"
      }
    }
  }
}`;

const URL_JSON_TEMPLATE = `{
  "mcpServers": {
    "liepin-mcp": {
      "url": "https://open-agent.liepin.com/mcp/user",
      "headers": { "x-user-token": "liepin_user_token_xxxx" }
    }
  }
}`;

function StatusDot({ status, error }: { status: string; error?: string | null }) {
  const dotClass = status === 'connected' ? 'status-dot connected'
    : status === 'error' ? 'status-dot error'
    : 'status-dot inactive';
  return (
    <span className={dotClass} title={error || status}>
      <span className="status-dot-inner" />
    </span>
  );
}

interface EnvRow { key: string; value: string; }

const emptyForm = { name: '', mode: 'stdio' as 'stdio' | 'url', command: '', url: '', args: '', env: [] as EnvRow[], headers: [] as EnvRow[] };

function ToolDetailModal({ server, onClose }: { server: McpServer; onClose: () => void }) {
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const tools = server.tools || [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="tool-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tool-modal-header">
          <h3>{server.name} 的工具列表</h3>
          <span className="tool-count">{tools.length} 个工具</span>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>
        <div className="tool-modal-body">
          {tools.length === 0 ? (
            <div className="panel-empty">暂未发现工具</div>
          ) : (
            tools.map((tool) => (
              <div key={tool.name} className="tool-detail-item">
                <div
                  className="tool-detail-header"
                  onClick={() => setExpandedTool(expandedTool === tool.name ? null : tool.name)}
                >
                  <code className="tool-detail-name">{tool.name}</code>
                  {tool.description && (
                    <span className="tool-detail-desc">{tool.description}</span>
                  )}
                  <span className="tool-expand-icon">
                    {expandedTool === tool.name ? '▲' : '▼'}
                  </span>
                </div>
                  {expandedTool === tool.name && tool.inputSchema && (
                    <pre className="tool-schema">
                    {JSON.stringify(tool.inputSchema, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface McpServersPanelProps {
  onToast?: (type: 'success' | 'error', message: string) => void;
}

export default function McpServersPanel({ onToast }: McpServersPanelProps) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [restarting, setRestarting] = useState<string | null>(null);
  const [detailServer, setDetailServer] = useState<McpServer | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMcpServers();
      setServers(data.servers || []);
    } catch (err) {
      onToast?.('error', `加载 MCP 服务失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const handleNew = () => {
    setEditingId('new');
    setForm({ ...emptyForm });
    setJsonMode(false);
    setJsonText('');
    setJsonError('');
  };

  const handleEdit = (server: McpServer) => {
    setEditingId(server.id);
    setForm({
      name: server.name || '',
      command: server.command || '',
      mode: server.url ? 'url' : 'stdio',
      url: server.url || '',
      args: (server.args || []).join('\n'),
      env: Object.entries(server.env || {}).map(([key, value]) => ({ key, value })),
      headers: Object.entries(server.headers || {}).map(([key, value]) => ({ key, value })),
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setJsonMode(false);
    setJsonText('');
    setJsonError('');
  };

  const addEnvRow = () => {
    setForm((prev) => ({ ...prev, env: [...prev.env, { key: '', value: '' }] }));
  };

  const removeEnvRow = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      env: prev.env.filter((_, i) => i !== idx),
    }));
  };

  const updateEnv = (idx: number, field: 'key' | 'value', val: string) => {
    setForm((prev) => {
      const env = [...prev.env];
      env[idx] = { ...env[idx], [field]: val };
      return { ...prev, env };
    });
  };

  const updateRows = (field: 'env' | 'headers', idx: number, key: 'key' | 'value', value: string) => {
    setForm((prev) => ({ ...prev, [field]: prev[field].map((row, i) => i === idx ? { ...row, [key]: value } : row) }));
  };

  const addHeaderRow = () => setForm((prev) => ({ ...prev, headers: [...prev.headers, { key: '', value: '' }] }));
  const removeHeaderRow = (idx: number) => setForm((prev) => ({ ...prev, headers: prev.headers.filter((_, i) => i !== idx) }));

  const validate = (): string | null => {
    if (!form.name.trim()) return '请输入服务名称';
    if (form.mode === 'stdio' && !form.command.trim()) return '请输入启动命令';
    if (form.mode === 'url') {
      try { const url = new URL(form.url.trim()); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
      catch { return '请输入有效的 HTTP(S) URL'; }
    }
    for (const row of form.env) {
      if (row.key.trim() && !row.value.trim()) {
        return `环境变量 "${row.key}" 的值不能为空`;
      }
    }
    return null;
  };

  const handleJsonSave = async () => {
    setJsonError('');
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setJsonError('JSON 格式无效');
      return;
    }

    const serversConfig = (parsed.mcpServers || parsed) as Record<string, unknown>;
    if (typeof serversConfig !== 'object' || Array.isArray(serversConfig)) {
      setJsonError('需要 mcpServers 对象或服务配置对象');
      return;
    }

    setSaving(true);
    let count = 0;
    for (const [name, cfg] of Object.entries(serversConfig)) {
      const conf = cfg as Record<string, unknown>;
      if (!conf || typeof conf !== 'object' || (!conf.command && !conf.url)) {
        setJsonError(`服务 "${name}" 需要 command 或 url 字段`);
        setSaving(false);
        return;
      }
      if (conf.command && conf.url) { setJsonError(`服务 "${name}" 不能同时包含 command 和 url`); setSaving(false); return; }
      try {
        await createMcpServer({
          name,
          command: conf.command as string,
          args: (conf.args as string[]) || [],
          env: (conf.env as Record<string, string>) || {},
          url: (conf.url as string) || null,
          headers: (conf.headers as Record<string, string>) || {},
        });
        count++;
      } catch (err) {
        setJsonError(`导入 "${name}" 失败: ${(err as Error).message}`);
        setSaving(false);
        return;
      }
    }
    onToast?.('success', `成功导入 ${count} 个服务`);
    setEditingId(null);
    setForm({ ...emptyForm });
    setJsonMode(false);
    setJsonText('');
    loadServers();
    setSaving(false);
  };

  const handleSave = async () => {
    if (jsonMode) {
      await handleJsonSave();
      return;
    }
    const errMsg = validate();
    if (errMsg) {
      onToast?.('error', errMsg);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        command: form.mode === 'stdio' ? form.command.trim() : '',
        url: form.mode === 'url' ? form.url.trim() : null,
        args: form.args.trim() ? form.args.split('\n').map((s) => s.trim()).filter(Boolean) : [],
        env: Object.fromEntries(
          form.env.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value.trim()])
        ),
        headers: Object.fromEntries(form.headers.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value.trim()])),
      };
      if (editingId === 'new') {
        await createMcpServer(payload);
      } else {
        await updateMcpServer(editingId as string, payload);
      }
      onToast?.('success', editingId === 'new' ? '服务创建成功' : '服务更新成功');
      setEditingId(null);
      setForm({ ...emptyForm });
      loadServers();
    } catch (err) {
      onToast?.('error', `保存失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除此 MCP 服务？')) return;
    try {
      await deleteMcpServer(id);
      onToast?.('success', '服务已删除');
      if (editingId === id) {
        setEditingId(null);
        setForm({ ...emptyForm });
      }
      loadServers();
    } catch (err) {
      onToast?.('error', `删除失败: ${(err as Error).message}`);
    }
  };

  const handleRestart = async (id: string) => {
    setRestarting(id);
    try {
      await restartMcpServer(id);
      onToast?.('success', '服务已重启');
      loadServers();
    } catch (err) {
      onToast?.('error', `重启失败: ${(err as Error).message}`);
    } finally {
      setRestarting(null);
    }
  };

  if (loading) {
    return <div className="panel-loading">加载中...</div>;
  }

  return (
    <div className="mcp-panel">
      {editingId ? (
        <div className="mcp-form">
          <div className="mcp-form-header">
            <h3>{editingId === 'new' ? '新建 MCP 服务' : '编辑 MCP 服务'}</h3>
            {editingId === 'new' && (
              <label className="json-toggle-label">
                <input
                  type="checkbox"
                  checked={jsonMode}
                  onChange={() => { setJsonMode(!jsonMode); setJsonError(''); }}
                />
                <span>JSON 配置</span>
              </label>
            )}
          </div>

          {jsonMode ? (
            <div className="form-group">
              <label>粘贴 JSON 配置</label>
              <p className="form-help">支持 stdio 和 URL 配置，也支持 Claude Desktop 格式（含 <code>mcpServers</code> 键）。</p>
              <textarea
                className="json-editor"
                value={jsonText}
                onChange={(e) => { setJsonText(e.target.value); setJsonError(''); }}
                placeholder={`${JSON_TEMPLATE}\n\nURL 示例：\n${URL_JSON_TEMPLATE}`}
                rows={12}
                spellCheck={false}
              />
              {jsonError && <div className="form-error">{jsonError}</div>}
            </div>
          ) : (
            <>
              <div className="form-group">
                <label>传输模式</label>
                <select value={form.mode} onChange={(e) => setForm((prev) => ({ ...prev, mode: e.target.value as 'stdio' | 'url' }))}>
                  <option value="stdio">本地命令（stdio）</option>
                  <option value="url">远程 URL（Streamable HTTP）</option>
                </select>
              </div>
              <div className="form-group">
                <label>名称</label>
                <input type="text" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="my-server" />
              </div>
              {form.mode === 'url' ? (
                <div className="form-group">
                  <label>服务 URL</label>
                  <input type="url" value={form.url} onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))} placeholder="https://example.com/mcp" />
                </div>
              ) : <>
              </>}
              {form.mode === 'url' ? (
                <div className="form-group">
                  <label>HTTP Headers</label>
                  <div className="env-list">
                    {form.headers.map((row, idx) => <div className="env-row" key={idx}>
                      <input type="text" value={row.key} onChange={(e) => updateRows('headers', idx, 'key', e.target.value)} placeholder="Header-Name" className="env-key" />
                      <input type="text" value={row.value} onChange={(e) => updateRows('headers', idx, 'value', e.target.value)} placeholder="value" className="env-value" />
                      <button className="env-remove-btn" onClick={() => removeHeaderRow(idx)} title="删除">×</button>
                    </div>)}
                    <button className="env-add-btn" onClick={addHeaderRow}>+ 添加 Header</button>
                  </div>
                </div>
              ) : (
              <>
              <div className="form-group">
                <label>启动命令</label>
                <input
                  type="text"
                  value={form.command}
                  onChange={(e) => setForm((prev) => ({ ...prev, command: e.target.value }))}
                  placeholder="npx"
                />
              </div>
              <div className="form-group">
                <label>参数（每行一个）</label>
                <textarea
                  value={form.args}
                  onChange={(e) => setForm((prev) => ({ ...prev, args: e.target.value }))}
                  placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/dir"
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label>环境变量</label>
                <div className="env-list">
                  {form.env.map((row, idx) => (
                    <div className="env-row" key={idx}>
                      <input
                        type="text"
                        value={row.key}
                        onChange={(e) => updateEnv(idx, 'key', e.target.value)}
                        placeholder="KEY"
                        className="env-key"
                      />
                      <input
                        type="text"
                        value={row.value}
                        onChange={(e) => updateEnv(idx, 'value', e.target.value)}
                        placeholder="value"
                        className="env-value"
                      />
                      <button className="env-remove-btn" onClick={() => removeEnvRow(idx)} title="删除">
                        <svg viewBox="0 0 24 24" width="14" height="14">
                          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <button className="env-add-btn" onClick={addEnvRow}>
                    + 添加变量
                  </button>
                </div>
              </div>
              </>
              )}
            </>
          )}

          <div className="mcp-form-actions">
            <button className="btn-secondary" onClick={handleCancel}>取消</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="panel-header">
            <button className="btn-primary" onClick={handleNew}>+ 新建服务</button>
          </div>
          {servers.length === 0 ? (
            <div className="panel-empty">暂无配置的 MCP 服务。</div>
          ) : (
            <table className="mcp-table">
              <thead>
                <tr>
                  <th>状态</th>
                  <th>名称</th>
                  <th>连接方式</th>
                  <th>工具</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((server) => (
                  <tr key={server.id}>
                    <td>
                      <StatusDot status={server.status || 'inactive'} error={server.errorMessage} />
                    </td>
                    <td className="mcp-name">{server.name}</td>
                    <td className="mcp-command">
                      <code>{server.url || server.command}</code>
                    </td>
                    <td>
                      <span className="tool-link" onClick={() => setDetailServer(server)}>
                        {(server.tools || []).length}
                      </span>
                    </td>
                    <td className="mcp-actions">
                      <button className="btn-icon" onClick={() => handleEdit(server)} title="编辑">
                        <svg viewBox="0 0 24 24" width="14" height="14">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor" />
                        </svg>
                      </button>
                      <button className="btn-icon" onClick={() => handleRestart(server.id)} disabled={restarting === server.id} title="重启">
                        <svg viewBox="0 0 24 24" width="14" height="14">
                          <path d="M17.65 6.35A7.96 7.96 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor" />
                        </svg>
                      </button>
                      <button className="btn-icon btn-icon-danger" onClick={() => handleDelete(server.id)} title="删除">
                        <svg viewBox="0 0 24 24" width="14" height="14">
                          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {detailServer && (
        <ToolDetailModal server={detailServer} onClose={() => setDetailServer(null)} />
      )}
    </div>
  );
}
