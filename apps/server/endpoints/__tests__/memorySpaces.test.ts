import { describe, expect, it } from 'vitest';
import { memoriesEndpoints } from '../definitions/memories.js';
import { conversationsEndpoints } from '../definitions/conversations.js';

describe('memory scope endpoint contracts', () => {
  it('registers management filters and batch assignment through declared endpoints', () => {
    const list = memoriesEndpoints.find(({ id }) => id === 'memories:list');
    const assignment = memoriesEndpoints.find(({ id }) => id === 'memories:assignScope');

    expect(list).toMatchObject({
      method: 'GET',
      path: '/',
      preloadMethod: 'getMemories',
    });
    expect(list?.args).toEqual([{ from: 'query' }]);
    expect(assignment).toMatchObject({
      method: 'POST',
      path: '/assign-scope',
      preloadMethod: 'assignMemoryScope',
    });
  });

  it('registers space CRUD and conversation binding with matching IPC methods', () => {
    expect(memoriesEndpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'memory-spaces:list',
          preloadMethod: 'getMemorySpaces',
        }),
        expect.objectContaining({
          id: 'memory-spaces:create',
          preloadMethod: 'createMemorySpace',
        }),
        expect.objectContaining({
          id: 'memory-spaces:update',
          preloadMethod: 'updateMemorySpace',
        }),
      ]),
    );
    expect(conversationsEndpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'conversations:getMemorySpace',
          method: 'GET',
          preloadMethod: 'getConversationMemorySpace',
        }),
        expect.objectContaining({
          id: 'conversations:setMemorySpace',
          method: 'PUT',
          preloadMethod: 'setConversationMemorySpace',
        }),
      ]),
    );
  });
});
