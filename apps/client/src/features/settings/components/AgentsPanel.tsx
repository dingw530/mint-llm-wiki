import { useState, useEffect, useCallback } from 'react';
import { fetchAgents, createAgent, updateAgent, deleteAgent, getMcpServers } from '@/services/api';
import type { Agent, McpServer } from '@/types';

const emptyForm = { name: '', description: '', systemPrompt: '', mcpServerIds: [] as string[], triggerKeywords: '' };

interface AgentsPanelProps {
  onToast?: (type: 'success' | 'error', message: string) => void;
}

export default function AgentsPanel({ onToast }: AgentsPanelProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [connectedServers, setConnectedServers] = useState<McpServer[]>([]);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAgents();
      setAgents(data.agents || []);
    } catch (err) {
      onToast?.('error', `加载 Agent 失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  const loadServers = useCallback(async () => {
    try {
      const data = await getMcpServers();
      const connected = (data.servers || []).filter((s) => s.status === 'connected');
      setConnectedServers(connected);
    } catch {
      setConnectedServers([]);
    }
  }, []);

  useEffect(() => {
    loadAgents();
    loadServers();
  }, [loadAgents, loadServers]);

  const handleNew = () => {
    setEditingId('new');
    setForm({ ...emptyForm });
  };

  const handleEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setForm({
      name: agent.name || '',
      description: agent.description || '',
      systemPrompt: agent.systemPrompt || '',
      mcpServerIds: agent.mcpServerIds || [],
      triggerKeywords: (agent.triggerKeywords || []).join(', '),
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
  };

  const toggleServer = (serverName: string) => {
    setForm((prev) => {
      const exists = prev.mcpServerIds.includes(serverName);
      return {
        ...prev,
        mcpServerIds: exists
          ? prev.mcpServerIds.filter((id) => id !== serverName)
          : [...prev.mcpServerIds, serverName],
      };
    });
  };

  const validate = (): string | null => {
    if (!form.name.trim()) return '请输入 Agent 名称';
    return null;
  };

  const handleSave = async () => {
    const errMsg = validate();
    if (errMsg) {
      onToast?.('error', errMsg);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        systemPrompt: form.systemPrompt.trim(),
        mcpServerIds: form.mcpServerIds,
        triggerKeywords: form.triggerKeywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      };
      if (editingId === 'new') {
        await createAgent(payload);
      } else {
        await updateAgent(editingId as string, payload);
      }
      onToast?.('success', editingId === 'new' ? 'Agent 创建成功' : 'Agent 更新成功');
      setEditingId(null);
      setForm({ ...emptyForm });
      loadAgents();
    } catch (err) {
      onToast?.('error', `保存失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确定删除此 Agent？')) return;
    try {
      await deleteAgent(id);
      onToast?.('success', 'Agent 已删除');
      if (editingId === id) {
        setEditingId(null);
        setForm({ ...emptyForm });
      }
      loadAgents();
    } catch (err) {
      onToast?.('error', `删除失败: ${(err as Error).message}`);
    }
  };

  if (loading) {
    return <div className="panel-loading">加载中...</div>;
  }

  return (
    <div className="agents-panel">
      {editingId ? (
        <div className="agent-form">
          <h3>{editingId === 'new' ? '新建 Agent' : '编辑 Agent'}</h3>

          <div className="form-group">
            <label>名称</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="我的助手"
            />
          </div>

          <div className="form-group">
            <label>描述</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="简要描述此 Agent 的功能"
            />
          </div>

          <div className="form-group">
            <label>触发关键词</label>
            <input
              type="text"
              value={form.triggerKeywords}
              onChange={(e) => setForm((prev) => ({ ...prev, triggerKeywords: e.target.value }))}
              placeholder="代码, 分析, 总结（逗号分隔，路由引擎据此自动匹配）"
            />
            <p className="form-help">输入关键词，用逗号分隔。用户消息包含这些关键词时，系统自动路由到此 Agent。</p>
          </div>

          <div className="form-group">
            <label>系统提示词</label>
            <textarea
              value={form.systemPrompt}
              onChange={(e) => setForm((prev) => ({ ...prev, systemPrompt: e.target.value }))}
              placeholder="你是一个专业的助手..."
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>绑定的 MCP 服务</label>
            <p className="form-help">选择 MCP 服务后，Agent 可使用该服务的全部工具</p>
            {connectedServers.length === 0 ? (
              <div className="tools-empty">暂无已连接的 MCP 服务。请先在 MCP Servers 页面配置。</div>
            ) : (
              <div className="tools-list">
                {connectedServers.map((server) => {
                  const toolCount = server.tools?.length || 0;
                  return (
                    <label key={server.name} className="tool-item">
                      <input
                        type="checkbox"
                        checked={form.mcpServerIds.includes(server.name)}
                        onChange={() => toggleServer(server.name)}
                      />
                      <span className="tool-name">{server.name}</span>
                      <span className="tool-desc">{toolCount} 个工具</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

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
            <button className="btn-primary" onClick={handleNew}>+ 新建 Agent</button>
          </div>
          {agents.filter((a) => a.id !== 'general').length === 0 ? (
            <div className="panel-empty">暂无自定义 Agent。</div>
          ) : (
            <table className="mcp-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>描述</th>
                  <th>触发关键词</th>
                  <th>绑定服务</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {agents
                  .filter((a) => a.id !== 'general')
                  .map((agent) => {
                    const ids = agent.mcpServerIds || [];
                    return (
                      <tr key={agent.id}>
                        <td className="mcp-name">{agent.name}</td>
                        <td className="agent-desc">{agent.description || '-'}</td>
                        <td className="agent-keywords">{(agent.triggerKeywords || []).join(', ') || '-'}</td>
                        <td>{ids.length > 0 ? ids.join(', ') : '-'}</td>
                        <td className="mcp-actions">
                          <button className="btn-icon" onClick={() => handleEdit(agent)} title="编辑">
                            <svg viewBox="0 0 24 24" width="14" height="14">
                              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor" />
                            </svg>
                          </button>
                          <button className="btn-icon btn-icon-danger" onClick={() => handleDelete(agent.id)} title="删除">
                            <svg viewBox="0 0 24 24" width="14" height="14">
                              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
