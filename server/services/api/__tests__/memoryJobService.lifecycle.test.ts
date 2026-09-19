import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  enqueue: vi.fn(),
  recoverProcessing: vi.fn(),
  claimNext: vi.fn(() => null),
  findByConversationId: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  getAiSettings: vi.fn(),
  performExtraction: vi.fn(),
  recordMemoryProcessingFailure: vi.fn(),
}));

vi.mock('../../../repositories/messageRepository.js', () => ({
  findByConversationId: dependencies.findByConversationId,
}));
vi.mock('../../../repositories/memoryJobRepository.js', () => ({
  enqueue: dependencies.enqueue,
  recoverProcessing: dependencies.recoverProcessing,
  claimNext: dependencies.claimNext,
  complete: dependencies.complete,
  fail: dependencies.fail,
}));
vi.mock('../settingsService.js', () => ({ getAiSettings: dependencies.getAiSettings }));
vi.mock('../memoryService.js', () => ({
  performExtraction: dependencies.performExtraction,
  recordMemoryProcessingFailure: dependencies.recordMemoryProcessingFailure,
}));

import {
  enqueueMemoryProcessing,
  startMemoryProcessing,
  stopMemoryProcessing,
} from '../memoryJobService.js';

describe('memory worker lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not start a queued setImmediate drain after shutdown', async () => {
    startMemoryProcessing();
    enqueueMemoryProcessing('conversation-1');
    await stopMemoryProcessing();
    await new Promise((resolve) => setImmediate(resolve));
    expect(dependencies.claimNext).not.toHaveBeenCalled();
  });
});
