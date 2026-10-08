import type { Dispatch, SetStateAction } from 'react';
import SelectField from '@/shared/components/SelectField';
import type { Memory } from '@/types';
import type { MemoryFormState } from './memoryPanelModel';

const CATEGORIES = [
  { id: '', label: '全部', icon: '📋' },
  { id: 'personal', label: '个人信息', icon: '👤' },
  { id: 'preference', label: '偏好', icon: '❤️' },
  { id: 'feedback', label: '反馈', icon: '💬' },
  { id: 'project', label: '项目', icon: '📌' },
  { id: 'goal', label: '目标', icon: '🎯' },
  { id: 'general', label: '通用', icon: '📝' },
];

const CATEGORY_LABELS: Record<string, string> = {
  personal: '个人信息',
  preference: '偏好',
  feedback: '反馈',
  project: '项目',
  goal: '目标',
  general: '通用',
};

export interface MemoryFilterBarProps {
  category: string;
  policy: string;
  includeInactive: boolean;
  onCategoryChange: (value: string) => void;
  onPolicyChange: (value: string) => void;
  onIncludeInactiveChange: (value: boolean) => void;
}

/** Render category, memory policy, and history filters. */
export function MemoryFilterBar(props: MemoryFilterBarProps) {
  return (
    <>
      <div className="category-bar">
        {CATEGORIES.map((item) => (
          <button
            key={item.id}
            className={`category-btn${props.category === item.id ? ' active' : ''}`}
            onClick={() => props.onCategoryChange(item.id)}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>
      <div className="memory-management-filters">
        <label className="memory-filter-field">
          <span>装入策略</span>
          <SelectField
            placeholder="记忆装入策略"
            value={props.policy}
            onChange={props.onPolicyChange}
            options={[
              { value: '', label: '全部策略' },
              { value: 'core', label: '常驻画像' },
              { value: 'retrievable', label: '按需召回' },
            ]}
          />
        </label>
        <label className="memory-inactive-filter">
          <input
            type="checkbox"
            checked={props.includeInactive}
            onChange={(event) => props.onIncludeInactiveChange(event.target.checked)}
          />
          显示历史
        </label>
      </div>
    </>
  );
}

export interface MemoryAssignmentModel {
  selectedIds: string[];
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  toggle: (id: string) => void;
  assign: () => Promise<void>;
}

/** Render the batch-ownership action only after the user selects memory rows. */
export function MemoryAssignmentToolbar({ model }: { model: MemoryAssignmentModel }) {
  if (model.selectedIds.length === 0) return null;
  return (
    <div className="memory-bulk-assign">
      <span>已选 {model.selectedIds.length} 条</span>
      <button
        type="button"
        className="btn-secondary"
        data-testid="memory-assign-scope"
        onClick={() => model.setExpanded(!model.expanded)}
      >
        批量归入用户全局
      </button>
      {model.expanded && (
        <button type="button" className="btn-primary" onClick={() => void model.assign()}>
          确认归入用户全局
        </button>
      )}
    </div>
  );
}

export interface MemoryEditorModel {
  editingId: string | null;
  form: MemoryFormState;
  setForm: Dispatch<SetStateAction<MemoryFormState>>;
  saving: boolean;
  startNew: () => void;
  cancelEdit: () => void;
  save: () => Promise<void>;
}

/** Render create/edit fields for one selected memory record. */
export function MemoryEditor({ model }: { model: MemoryEditorModel }) {
  if (model.editingId === null) {
    return (
      <button className="add-memory-btn" onClick={model.startNew}>
        + 添加记忆
      </button>
    );
  }
  return (
    <div className={`memory-form${model.editingId === 'new' ? ' is-new' : ''}`}>
      <div className="form-group">
        <label>内容</label>
        <textarea
          value={model.form.content}
          onChange={(event) => model.setForm((prev) => ({ ...prev, content: event.target.value }))}
          placeholder="输入记忆内容..."
          rows={3}
        />
      </div>
      <div className="form-group">
        <label>分类</label>
        <SelectField
          placeholder="分类"
          options={[
            { value: '', label: '通用' },
            { value: 'personal', label: '个人信息' },
            { value: 'preference', label: '偏好' },
            { value: 'feedback', label: '反馈' },
            { value: 'project', label: '项目' },
            { value: 'goal', label: '目标' },
          ]}
          value={model.form.category}
          onChange={(value) => model.setForm((prev) => ({ ...prev, category: value }))}
        />
      </div>
      <div className="form-group">
        <label>事实键</label>
        <input
          value={model.form.memoryKey}
          maxLength={120}
          onChange={(event) =>
            model.setForm((prev) => ({ ...prev, memoryKey: event.target.value }))
          }
          placeholder="例如 preference.response_language"
        />
      </div>
      {model.editingId === 'new' ? (
        <MemoryCreatePolicyFields model={model} />
      ) : (
        <div className="form-group">
          <label>装入策略</label>
          <button
            type="button"
            className={`memory-core-toggle${model.form.contextPolicy === 'core' ? ' is-core' : ''}`}
            data-testid="memory-core-toggle"
            onClick={() =>
              model.setForm((prev) => ({
                ...prev,
                contextPolicy: prev.contextPolicy === 'core' ? 'retrievable' : 'core',
              }))
            }
          >
            {model.form.contextPolicy === 'core' ? '常驻画像' : '按需召回'}
          </button>
        </div>
      )}
      <div className="form-actions">
        <button className="btn-secondary" onClick={model.cancelEdit}>
          取消
        </button>
        <button className="btn-primary" onClick={() => void model.save()} disabled={model.saving}>
          {model.saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}

function MemoryCreatePolicyFields({ model }: { model: MemoryEditorModel }) {
  return (
    <>
      <div className="form-group">
        <label>装入策略</label>
        <SelectField
          placeholder="装入策略"
          options={[
            { value: 'retrievable', label: '按需召回' },
            { value: 'core', label: '常驻画像' },
          ]}
          value={model.form.contextPolicy}
          onChange={(value) =>
            model.setForm((prev) => ({
              ...prev,
              contextPolicy: value as 'core' | 'retrievable',
            }))
          }
        />
      </div>
    </>
  );
}

export interface MemoryCardModel {
  selectedIds: string[];
  toggleSelected: (id: string) => void;
  edit: (memory: Memory) => void;
  toggleCorePolicy: (memory: Memory) => void;
  delete: (id: string) => void;
}

/** Render one user-visible memory fact with policy and source metadata. */
export function MemoryCard({ memory, model }: { memory: Memory; model: MemoryCardModel }) {
  return (
    <div className="memory-card" data-testid={`memory-card-${memory.id}`}>
      <div className="memory-card-header">
        <div className="memory-card-tags">
          <label className="memory-select-control">
            <input
              type="checkbox"
              data-testid={`memory-select-${memory.id}`}
              aria-label={`选择记忆 ${memory.content.slice(0, 30)}`}
              checked={model.selectedIds.includes(memory.id)}
              onChange={() => model.toggleSelected(memory.id)}
            />
          </label>
          <span className={`memory-badge ${getBadgeClass(memory.category)}`}>
            {getBadgeLabel(memory.category)}
          </span>
          {memory.scopeKind === 'unassigned' && (
            <span className="memory-scope-badge unassigned">待归属</span>
          )}
        </div>
        <div className="memory-actions">
          <button
            type="button"
            className={`memory-core-toggle${memory.contextPolicy === 'core' ? ' is-core' : ''}`}
            data-testid="memory-core-toggle"
            aria-label={`${memory.contextPolicy === 'core' ? '取消常驻' : '设为常驻'}：${memory.content.slice(0, 30)}`}
            title={memory.scopeKind === 'unassigned' ? '先为记忆设置归属' : '切换是否常驻画像'}
            disabled={memory.scopeKind === 'unassigned' || memory.status !== 'active'}
            onClick={() => model.toggleCorePolicy(memory)}
          >
            {memory.contextPolicy === 'core' ? '常驻画像' : '按需召回'}
          </button>
          <button
            className="edit-btn"
            data-testid={`memory-edit-${memory.id}`}
            onClick={() => model.edit(memory)}
            title="编辑"
          >
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path
                d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
                fill="currentColor"
              />
            </svg>
          </button>
          <button className="delete-btn" onClick={() => model.delete(memory.id)} title="删除">
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path
                d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="memory-content">{memory.content}</div>
      <div className="memory-meta">
        {formatDateTime(memory.createdAt)}
        {memory.status && memory.status !== 'active' && ` · ${memory.status}`}
        {memory.sourceConversationId && ' · 来源对话'}
      </div>
    </div>
  );
}

export function MemoryCardList({
  memories,
  model,
}: {
  memories: Memory[];
  model: MemoryCardModel;
}) {
  if (memories.length === 0) {
    return (
      <div className="memory-empty">
        <p>暂无记忆</p>
        <p>开启记忆功能后，AI 会按需从对话中提取事实。</p>
      </div>
    );
  }
  return memories.map((memory) => <MemoryCard key={memory.id} memory={memory} model={model} />);
}

function formatDateTime(isoStr: string | undefined | null): string {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getBadgeLabel(category: string | undefined | null): string {
  return CATEGORY_LABELS[category || ''] || category || '通用';
}

function getBadgeClass(category: string | undefined | null): string {
  const cls = category || 'general';
  return CATEGORY_LABELS[cls] ? cls : 'general';
}
