import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/types';
import { groupConversationsByDate } from '../conversationGroups';

const now = new Date(2026, 7, 12, 12, 0);

function conversation(id: string, updatedAt: string): Conversation {
  return {
    id,
    title: id,
    type: 'chat',
    createdAt: updatedAt,
    updatedAt,
    lockedAgent: null,
    routingMode: 'manual',
  };
}

describe('groupConversationsByDate', () => {
  it('groups by local calendar day and omits empty groups', () => {
    const groups = groupConversationsByDate([
      conversation('today', '2026-08-12T01:00:00.000Z'),
      conversation('yesterday', '2026-08-11T01:00:00.000Z'),
      conversation('week', '2026-08-05T12:00:00.000Z'),
      conversation('month', '2026-07-13T12:00:00.000Z'),
      conversation('older', '2026-07-11T12:00:00.000Z'),
    ], now);

    expect(groups.map((group) => [group.label, group.conversations.map((item) => item.id)])).toEqual([
      ['今天', ['today']],
      ['昨天', ['yesterday']],
      ['7天内', ['week']],
      ['30天内', ['month']],
      ['更早', ['older']],
    ]);
  });

  it('sorts each group by updatedAt descending and handles invalid dates', () => {
    const groups = groupConversationsByDate([
      conversation('older', '2026-08-12T08:00:00.000Z'),
      conversation('newer', '2026-08-12T10:00:00.000Z'),
      conversation('invalid', 'not-a-date'),
    ], now);

    expect(groups[0].conversations.map((item) => item.id)).toEqual(['newer', 'older']);
    expect(groups[1]).toEqual({ label: '更早', conversations: [conversation('invalid', 'not-a-date')] });
  });

  it('uses calendar boundaries for month and seven-day cutoffs', () => {
    const groups = groupConversationsByDate([
      conversation('seven-days', '2026-08-05T00:01:00.000Z'),
      conversation('eight-days', '2026-08-04T15:59:00.000Z'),
      conversation('thirty-days', '2026-07-13T23:59:00.000Z'),
      conversation('thirty-one-days', '2026-07-12T15:59:00.000Z'),
    ], now);

    expect(groups.map((group) => [group.label, group.conversations.map((item) => item.id)])).toEqual([
      ['7天内', ['seven-days']],
      ['30天内', ['eight-days', 'thirty-days']],
      ['更早', ['thirty-one-days']],
    ]);
  });
});
