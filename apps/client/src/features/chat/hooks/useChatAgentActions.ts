import { useCallback } from 'react';
import { lockAgent, unlockAgent } from '@/services/api';
import type { Conversation } from '@/types';

interface UseChatAgentActionsOptions {
  activeConversation: string | null;
  routingMode: string;
  onUpdateConversation?: (convId: string, updates: Partial<Conversation>) => void;
  setActiveAgent: (value: string) => void;
}

/** 管理助手锁定、解锁和手动选择动作。 */
export default function useChatAgentActions({
  activeConversation,
  routingMode,
  onUpdateConversation,
  setActiveAgent,
}: UseChatAgentActionsOptions) {
  const handleLock = useCallback(async (agentId: string) => {
    if (!activeConversation) return;
    try {
      const data = await lockAgent(activeConversation, agentId);
      if (data.conversation && onUpdateConversation) onUpdateConversation(activeConversation, data.conversation);
    } catch (error) {
      console.error('Failed to lock agent:', error);
    }
  }, [activeConversation, onUpdateConversation]);

  const handleUnlock = useCallback(async () => {
    if (!activeConversation) return;
    try {
      const data = await unlockAgent(activeConversation);
      if (data.conversation && onUpdateConversation) onUpdateConversation(activeConversation, data.conversation);
    } catch (error) {
      console.error('Failed to unlock agent:', error);
    }
  }, [activeConversation, onUpdateConversation]);

  const handleSelectAgent = useCallback((agentId: string) => {
    if (routingMode === 'auto') handleLock(agentId);
    else setActiveAgent(agentId);
  }, [handleLock, routingMode, setActiveAgent]);

  return { handleSelectAgent, handleUnlock };
}
