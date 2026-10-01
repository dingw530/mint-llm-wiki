import { describe, expect, it } from 'vitest';
import { shouldPromoteToCore } from '../memoryCorePolicy.js';

const BASE_CANDIDATE = {
  memoryKey: 'preference.response_language',
  subject: 'user',
  memoryType: 'semantic',
  confidence: 0.9,
  scope: { scopeKind: 'global' as const, spaceId: null, bindingRevision: 1 },
  content: '用户偏好使用中文回复',
  userSourceText: '以后请用中文回答',
};

describe('automatic core memory policy', () => {
  it('promotes explicit high-confidence facts from the allowlist', () => {
    expect(shouldPromoteToCore(BASE_CANDIDATE)).toBe(true);
  });

  it('rejects unapproved keys, non-user subjects, low confidence, and space facts', () => {
    expect(shouldPromoteToCore({ ...BASE_CANDIDATE, memoryKey: 'personal.name' })).toBe(false);
    expect(shouldPromoteToCore({ ...BASE_CANDIDATE, subject: 'teammate' })).toBe(false);
    expect(shouldPromoteToCore({ ...BASE_CANDIDATE, confidence: 0.79 })).toBe(false);
    expect(
      shouldPromoteToCore({
        ...BASE_CANDIDATE,
        scope: { scopeKind: 'space', spaceId: 'space-a', bindingRevision: 2 },
      }),
    ).toBe(false);
  });

  it('requires lexical evidence in a persisted user message', () => {
    expect(shouldPromoteToCore({ ...BASE_CANDIDATE, userSourceText: null })).toBe(false);
    expect(shouldPromoteToCore({ ...BASE_CANDIDATE, userSourceText: '我在学习摄影和做饭' })).toBe(
      false,
    );
  });
});
