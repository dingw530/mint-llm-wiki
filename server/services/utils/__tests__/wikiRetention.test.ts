import { describe, expect, it } from 'vitest';
import { calculateWikiRetentionScore } from '../wikiRetention.js';

describe('calculateWikiRetentionScore', () => {
  it('decays with time but keeps the score bounded', () => {
    const now = new Date('2026-07-24T00:00:00.000Z');
    const fresh = calculateWikiRetentionScore({
      confidence: 0.8,
      importance: 0.8,
      accessCount: 0,
      now,
      lastConfirmedAt: now.toISOString(),
    });
    const old = calculateWikiRetentionScore({
      confidence: 0.8,
      importance: 0.8,
      accessCount: 0,
      now,
      lastConfirmedAt: '2025-07-24T00:00:00.000Z',
    });
    expect(fresh).toBeGreaterThan(old);
    expect(old).toBeGreaterThanOrEqual(0);
    expect(old).toBeLessThanOrEqual(1.2);
  });

  it('adds a bounded access boost', () => {
    const input = {
      confidence: 0.5,
      importance: 0.5,
      now: new Date('2026-07-24T00:00:00.000Z'),
      lastConfirmedAt: '2026-07-24T00:00:00.000Z',
    };
    const once = calculateWikiRetentionScore({ ...input, accessCount: 1 });
    const many = calculateWikiRetentionScore({ ...input, accessCount: 1_000_000 });
    expect(many).toBeGreaterThan(once);
    expect(many - once).toBeLessThanOrEqual(0.2);
  });
});
