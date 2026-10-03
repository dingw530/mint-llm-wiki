import { afterAll, describe, expect, it } from 'vitest';

// Uses the shared DB from vitest config

import * as agentRepo from '../agent-repository.js';
import type { Agent } from '../../../types.js';

describe('agentRepository', () => {
  afterAll(() => {
    // Clean up custom agents
    try {
      agentRepo.deleteById('test-agent-1');
    } catch {}
    try {
      agentRepo.deleteById('test-agent-2');
    } catch {}
  });

  describe('findAll', () => {
    it('returns built-in agents', () => {
      const agents = agentRepo.findAll();
      // general is seeded in db.ts
      expect(agents.length).toBeGreaterThanOrEqual(1);
      expect(agents.find((a) => a.id === 'general')).toBeDefined();
      expect(agents.find((a) => a.id === 'weather')).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('finds built-in agents', () => {
      const agent = agentRepo.findById('general');
      expect(agent).not.toBeNull();
      expect(agent!.name).toBe('通用助手');
    });

    it('returns null for non-existent', () => {
      expect(agentRepo.findById('nonexistent')).toBeNull();
    });
  });

  describe('create', () => {
    it('creates a custom agent', () => {
      const agent = agentRepo.create({
        id: 'test-agent-1',
        name: 'Test Agent',
        description: 'For testing',
        type: 'custom',
        systemPrompt: 'You are a test assistant',
        mcpServerIds: [],
        available: true,
        triggerKeywords: ['test'],
      });
      expect(agent.id).toBe('test-agent-1');
      expect(agent.name).toBe('Test Agent');
    });

    it('creates with minimal fields', () => {
      const agent = agentRepo.create({
        id: 'test-agent-2',
        name: 'Minimal Agent',
      });
      expect(agent.id).toBe('test-agent-2');
      expect(agent.name).toBe('Minimal Agent');
    });
  });

  describe('update', () => {
    it('updates existing agent fields', () => {
      const updated = agentRepo.update('test-agent-1', {
        name: 'Updated Agent',
        description: 'Updated description',
        triggerKeywords: ['updated'],
      });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Agent');
      expect(updated!.triggerKeywords).toEqual(['updated']);
    });

    it('returns null for non-existent', () => {
      const result = agentRepo.update('nonexistent', { name: 'test' });
      expect(result).toBeNull();
    });

    it('sets available and errorMessage', () => {
      const result = agentRepo.update('test-agent-2', {
        available: false,
        errorMessage: 'Not available right now',
      });
      expect(result!.available).toBe(false);
      expect(result!.errorMessage).toBe('Not available right now');
    });
  });

  describe('deleteById', () => {
    it('deletes a custom agent', () => {
      const result = agentRepo.deleteById('test-agent-1');
      expect(result.changes).toBe(1);
      expect(agentRepo.findById('test-agent-1')).toBeNull();
    });

    it('returns zero changes for non-existent', () => {
      const result = agentRepo.deleteById('nonexistent');
      expect(result.changes).toBe(0);
    });
  });
});
