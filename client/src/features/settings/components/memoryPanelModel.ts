import { useCallback, useEffect, useState } from 'react';
import {
  assignMemoryScope,
  createMemory,
  deleteMemory,
  getMemories,
  updateMemory,
} from '@/services/api';
import type { Memory } from '@/types';

export type MemoryPanelToast = (type: 'success' | 'error', message: string) => void;

export interface MemoryFilters {
  category: string;
  policy: string;
  includeInactive: boolean;
}

export interface MemoryFormState {
  content: string;
  category: string;
  memoryKey: string;
  contextPolicy: 'core' | 'retrievable';
}

export const EMPTY_MEMORY_FORM: MemoryFormState = {
  content: '',
  category: '',
  memoryKey: '',
  contextPolicy: 'retrievable',
};

export function useMemoryList(filters: MemoryFilters, onToast?: MemoryPanelToast) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    try {
      const contextPolicy = filters.policy ? (filters.policy as 'core' | 'retrievable') : undefined;
      const [globalMemories, unassignedMemories] = await Promise.all([
        getMemories(
          filters.category,
          'global',
          undefined,
          contextPolicy,
          false,
          filters.includeInactive,
        ),
        getMemories(
          filters.category,
          'unassigned',
          undefined,
          contextPolicy,
          true,
          filters.includeInactive,
        ),
      ]);
      setMemories([...globalMemories, ...unassignedMemories]);
    } catch (error) {
      onToast?.('error', `加载记忆失败: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [filters.category, filters.includeInactive, filters.policy, onToast]);

  useEffect(() => {
    void fetchMemories();
  }, [fetchMemories]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('确定删除此记忆？')) return;
      try {
        await deleteMemory(id);
        onToast?.('success', '记忆已删除');
        await fetchMemories();
      } catch (error) {
        onToast?.('error', `删除失败: ${(error as Error).message}`);
      }
    },
    [fetchMemories, onToast],
  );

  const toggleCorePolicy = useCallback(
    async (memory: Memory) => {
      const contextPolicy = memory.contextPolicy === 'core' ? 'retrievable' : 'core';
      try {
        await updateMemory(memory.id, { contextPolicy });
        onToast?.('success', contextPolicy === 'core' ? '已加入常驻画像' : '已改为按需召回');
        await fetchMemories();
      } catch (error) {
        onToast?.('error', `更新策略失败: ${(error as Error).message}`);
      }
    },
    [fetchMemories, onToast],
  );

  return { memories, loading, fetchMemories, handleDelete, toggleCorePolicy };
}

export function useMemoryEditor(
  onToast: MemoryPanelToast | undefined,
  fetchMemories: () => Promise<void>,
  activeCategory: string,
) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MemoryFormState>({ ...EMPTY_MEMORY_FORM });
  const [saving, setSaving] = useState(false);

  const startNew = useCallback(() => {
    setEditingId('new');
    setForm({
      ...EMPTY_MEMORY_FORM,
      category: activeCategory,
    });
  }, [activeCategory]);

  const startEdit = useCallback((memory: Memory) => {
    setEditingId(memory.id);
    setForm({
      content: memory.content || '',
      category: memory.category || '',
      memoryKey: memory.memoryKey || '',
      contextPolicy: memory.contextPolicy || 'retrievable',
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setForm({ ...EMPTY_MEMORY_FORM });
  }, []);

  const save = useCallback(async () => {
    if (!form.content.trim()) {
      onToast?.('error', '请输入记忆内容');
      return;
    }
    setSaving(true);
    try {
      const payload: Partial<Memory> & { content: string } = {
        content: form.content.trim(),
        contextPolicy: form.contextPolicy,
        ...(form.category ? { category: form.category } : {}),
        ...(form.memoryKey.trim() ? { memoryKey: form.memoryKey.trim() } : {}),
      };
      if (editingId === 'new') {
        payload.scopeKind = 'global';
        payload.spaceId = null;
        await createMemory(payload);
        onToast?.('success', '记忆已创建');
      } else if (editingId) {
        await updateMemory(editingId, payload);
        onToast?.('success', '记忆已更新');
      }
      cancelEdit();
      await fetchMemories();
    } catch (error) {
      onToast?.('error', `保存失败: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [cancelEdit, editingId, fetchMemories, form, onToast]);

  return { editingId, form, setForm, saving, startNew, startEdit, cancelEdit, save };
}

export function useMemoryAssignment(
  onToast: MemoryPanelToast | undefined,
  fetchMemories: () => Promise<void>,
) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }, []);

  const assign = useCallback(async () => {
    if (selectedIds.length === 0) return;
    try {
      const result = await assignMemoryScope({
        ids: selectedIds,
        scopeKind: 'global',
        spaceId: null,
      });
      onToast?.('success', `已为 ${result.updated} 条记忆设置归属`);
      setExpanded(false);
      await fetchMemories();
      setSelectedIds([]);
    } catch (error) {
      onToast?.('error', `归属失败: ${(error as Error).message}`);
    }
  }, [fetchMemories, onToast, selectedIds]);

  return { selectedIds, expanded, setExpanded, toggle, assign };
}
