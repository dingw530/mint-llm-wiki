import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getConversations as fetchConvs,
  createConversation as createConv,
  deleteConversation as deleteConv,
  clearAllConversations as clearAllConvs,
  renameConversation as renameConv,
} from '@/services/api';
import type { Conversation } from '@/types';

const DEFAULT_CONVERSATION_TITLE = 'New Conversation';

export function useConversations(type?: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const typeRef = useRef(type);

  const getConversations = useCallback(async (fetchType?: string) => {
    try {
      const data = await fetchConvs(fetchType);
      setConversations((previous) => {
        const previousById = new Map(previous.map((conversation) => [conversation.id, conversation]));
        return (data.conversations || []).map((conversation) => {
          const previousConversation = previousById.get(conversation.id);
          const hasGeneratedTitle = previousConversation
            && previousConversation.title !== DEFAULT_CONVERSATION_TITLE
            && conversation.title === DEFAULT_CONVERSATION_TITLE;
          return hasGeneratedTitle
            ? { ...conversation, title: previousConversation.title }
            : conversation;
        });
      });
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    getConversations(type);
    typeRef.current = type;
  }, [type, getConversations]);

  // auto-select first conversation when loading completes and activeId is stale
  useEffect(() => {
    if (!loading) {
      if (conversations.length > 0) {
        if (!activeId || !conversations.find((c) => c.id === activeId)) {
          setActiveId(conversations[0].id);
        }
      } else {
        setActiveId(null);
      }
    }
  }, [loading, conversations, activeId]);

  const create = useCallback(async (title?: string, convType?: string): Promise<string | undefined> => {
    try {
      const data = await createConv(title || 'New Conversation', convType);
      setConversations((prev) => [data.conversation, ...prev]);
      setActiveId(data.conversation.id);
      return data.conversation.id;
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  }, []);

  const deleteConv_ = useCallback(async (id: string) => {
    try {
      await deleteConv(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      setActiveId((prev) => (prev === id ? null : prev));
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  }, []);

  const clearAll = useCallback(async () => {
    try {
      await clearAllConvs();
      setConversations([]);
      setActiveId(null);
    } catch (err) {
      console.error('Failed to clear conversations:', err);
    }
  }, []);

  const rename = useCallback(async (id: string, title: string) => {
    try {
      const data = await renameConv(id, title);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? data.conversation : c))
      );
    } catch (err) {
      console.error('Failed to rename conversation:', err);
    }
  }, []);

  const updateTitle = useCallback((convId: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, title } : c))
    );
  }, []);

  const updateConversation = useCallback((convId: string, updates: Partial<Conversation>) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, ...updates } : c))
    );
  }, []);

  return {
    conversations,
    loading,
    activeId,
    setActiveId,
    fetchConversations: getConversations,
    create,
    delete: deleteConv_,
    clearAll,
    rename,
    updateTitle,
    updateConversation,
  };
}
