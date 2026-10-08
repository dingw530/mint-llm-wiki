import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as conversations from '../index.js';
import * as conversationRepository from '../../../infrastructure/persistence/conversation-repository.js';
import * as settingsRepository from '../../../infrastructure/config/settings-repository.js';

vi.mock('../../../infrastructure/config/settings-repository.js', () => ({ getAll: vi.fn() }));

const createdIds = new Set<string>();

/** Create an isolated fixture and register its deletion without clearing shared conversations. */
function createFixture(title = 'domain conversation', type = 'text') {
  const conversation = conversations.create({ title, type });
  createdIds.add(conversation.id);
  return conversation;
}

beforeEach(() => {
  vi.mocked(settingsRepository.getAll).mockReturnValue({ routingMode: 'manual' });
});
afterEach(() => {
  for (const id of createdIds) conversationRepository.deleteById(id);
  createdIds.clear();
  vi.clearAllMocks();
});

describe('Conversations management with SQLite', () => {
  it('creates the existing default title and configured route mode', () => {
    const conversation = createFixture('');
    expect(conversation).toMatchObject({
      title: 'New Chat',
      routingMode: 'manual',
      lockedAgent: null,
    });
    expect(conversations.findById(conversation.id)).toEqual(conversation);
  });

  it('falls back to auto when the configured mode is absent or empty', () => {
    vi.mocked(settingsRepository.getAll).mockReturnValue({ routingMode: '' });
    expect(createFixture().routingMode).toBe('auto');
    vi.mocked(settingsRepository.getAll).mockReturnValue({});
    expect(createFixture().routingMode).toBe('auto');
  });

  it('filters by conversation type', () => {
    const text = createFixture('text fixture');
    const image = createFixture('image fixture', 'image');
    const images = conversations.list('image');
    expect(images.some((row) => row.id === image.id)).toBe(true);
    expect(images.some((row) => row.id === text.id)).toBe(false);
    expect(images.every((row) => row.type === 'image')).toBe(true);
  });

  it('renames while preserving route mode and Agent locking', () => {
    const original = createFixture();
    conversations.setLockedAgent(original.id, 'custom-agent');
    expect(conversations.rename(original.id, 'new title')).toMatchObject({
      title: 'new title',
      routingMode: 'manual',
      lockedAgent: 'custom-agent',
    });
    expect(conversations.setLockedAgent(original.id, null)?.lockedAgent).toBeNull();
  });

  it('preserves nullable metadata lookup and 404 errors for missing writes', () => {
    const missing = 'conversations-domain-missing-fixture';
    expect(conversations.findById(missing)).toBeNull();
    expect(() => conversations.rename(missing, 'title')).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    expect(() => conversations.remove(missing)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => conversations.setLockedAgent(missing, null)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('rejects an empty rename with status 400 without changing storage', () => {
    const original = createFixture();
    expect(() => conversations.rename(original.id, '')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(conversations.findById(original.id)?.title).toBe(original.title);
  });

  it('removes a conversation and preserves the existing success result', () => {
    const original = createFixture();
    expect(conversations.remove(original.id)).toEqual({ success: true });
    expect(conversations.findById(original.id)).toBeNull();
  });
});
