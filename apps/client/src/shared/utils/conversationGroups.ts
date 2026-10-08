import type { Conversation } from '@/types';

export interface ConversationGroup {
  label: string;
  conversations: Conversation[];
}

const GROUP_LABELS = ['今天', '昨天', '7天内', '30天内', '更早'] as const;

function startOfLocalDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function getGroupIndex(updatedAt: string, now: Date): number {
  const timestamp = new Date(updatedAt);
  if (Number.isNaN(timestamp.getTime())) return GROUP_LABELS.length - 1;

  const dayDiff = Math.floor((startOfLocalDay(now) - startOfLocalDay(timestamp)) / 86_400_000);
  if (dayDiff <= 0) return 0;
  if (dayDiff === 1) return 1;
  if (dayDiff <= 7) return 2;
  if (dayDiff <= 30) return 3;
  return 4;
}

/**
 * 按会话最近更新时间分组，并保证每组内按更新时间从新到旧排列。
 * @param conversations 待分组的会话列表
 * @param now 用于计算日期边界的当前时间，默认使用当前时间
 * @returns 按“今天”到“更早”排列的非空会话分组
 */
export function groupConversationsByDate(
  conversations: Conversation[],
  now: Date = new Date(),
): ConversationGroup[] {
  const groups = GROUP_LABELS.map((label) => ({ label, conversations: [] as Conversation[] }));

  conversations.forEach((conversation) => {
    groups[getGroupIndex(conversation.updatedAt, now)].conversations.push(conversation);
  });

  return groups
    .filter((group) => group.conversations.length > 0)
    .map((group) => ({
      ...group,
      conversations: [...group.conversations].sort((a, b) => {
        const aTime = new Date(a.updatedAt).getTime();
        const bTime = new Date(b.updatedAt).getTime();
        return (Number.isNaN(bTime) ? Number.NEGATIVE_INFINITY : bTime)
          - (Number.isNaN(aTime) ? Number.NEGATIVE_INFINITY : aTime);
      }),
    }));
}
