import { useState } from 'react';
import type { MemoryPanelToast } from './memoryPanelModel';
import {
  MemoryAssignmentToolbar,
  MemoryCardList,
  MemoryEditor,
  MemoryFilterBar,
} from './MemoryPanelViews';
import { useMemoryAssignment, useMemoryEditor, useMemoryList } from './memoryPanelModel';

interface MemoriesPanelProps {
  onToast?: MemoryPanelToast;
}

/** Compose the memory workspace controls, filters, editor, and scoped fact list. */
export default function MemoriesPanel({ onToast }: MemoriesPanelProps) {
  const [category, setCategory] = useState('');
  const [policy, setPolicy] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const filters = { category, policy, includeInactive };
  const list = useMemoryList(filters, onToast);
  const editor = useMemoryEditor(onToast, list.fetchMemories, category);
  const assignment = useMemoryAssignment(onToast, list.fetchMemories);
  const cardModel = {
    selectedIds: assignment.selectedIds,
    toggleSelected: assignment.toggle,
    edit: editor.startEdit,
    toggleCorePolicy: list.toggleCorePolicy,
    delete: list.handleDelete,
  };
  const visibleMemories = list.memories.filter((memory) => memory.id !== editor.editingId);

  if (list.loading && list.memories.length === 0) {
    return (
      <div className="skeleton-panel">
        <div className="skeleton skeleton-panel-header" />
        <div className="skeleton skeleton-panel-row" />
        <div className="skeleton skeleton-panel-row" />
        <div className="skeleton skeleton-panel-row short" />
        <div className="skeleton skeleton-panel-row" />
      </div>
    );
  }

  return (
    <div className="memories-panel" data-testid="memory-panel">
      <MemoryFilterBar
        category={category}
        policy={policy}
        includeInactive={includeInactive}
        onCategoryChange={setCategory}
        onPolicyChange={setPolicy}
        onIncludeInactiveChange={setIncludeInactive}
      />
      {list.memories.some((memory) => memory.scopeKind === 'unassigned') && (
        <p className="memory-unassigned-notice" role="status">
          历史记忆待归属：这些旧记忆不会参与回答；选中后可批量归入用户全局。
        </p>
      )}
      <MemoryAssignmentToolbar model={assignment} />
      <MemoryEditor model={editor} />
      <MemoryCardList memories={visibleMemories} model={cardModel} />
    </div>
  );
}
