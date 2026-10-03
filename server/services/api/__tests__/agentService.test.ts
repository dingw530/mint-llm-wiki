import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ──

vi.mock('../../../repositories/agentRepository.js', () => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteById: vi.fn(),
}));

import * as agentRepo from '../../../repositories/agentRepository.js';
import * as agentService from '../agentService.js';
import type { Agent } from '../../../types.js';

// ── Fixtures ──

const GENERAL_AGENT: Agent = {
  id: 'general',
  name: '通用助手',
  description: '通用 AI 助手',
  type: 'general',
  systemPrompt: '你是一个通用助手',
  mcpServerIds: [],
  available: true,
  errorMessage: null,
  triggerKeywords: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const CUSTOM_AGENT: Agent = {
  id: 'my-custom',
  name: '自定义 Agent',
  description: '用户自定义',
  type: 'custom',
  systemPrompt: '你是自定义助手',
  mcpServerIds: ['my-server'],
  available: true,
  errorMessage: null,
  triggerKeywords: ['custom'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ORCHESTRATOR_AGENT: Agent = {
  id: 'orchestrator',
  name: '编排助手',
  description: '编排子任务',
  type: 'orchestrator',
  systemPrompt: '你是一个助手',
  mcpServerIds: [],
  available: true,
  errorMessage: null,
  triggerKeywords: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('agentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('returns all agents with correct availability', () => {
      vi.mocked(agentRepo.findAll).mockReturnValue([{ ...GENERAL_AGENT }, { ...CUSTOM_AGENT }]);

      const result = agentService.list();

      expect(result).toHaveLength(2);
      expect(result.map((a) => a.id)).toEqual(['general', 'my-custom']);
    });
  });

  describe('findById', () => {
    it('returns null when agent not found', () => {
      vi.mocked(agentRepo.findById).mockReturnValue(null);
      expect(agentService.findById('nonexistent')).toBeNull();
    });

    it('returns general agent as-is', () => {
      vi.mocked(agentRepo.findById).mockReturnValue({ ...GENERAL_AGENT });
      const result = agentService.findById('general');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('general');
    });

    it('appends orchestrator instruction to orchestrator agent system prompt', () => {
      vi.mocked(agentRepo.findById).mockReturnValue({ ...ORCHESTRATOR_AGENT });
      const result = agentService.findById('orchestrator');
      expect(result).not.toBeNull();
      expect(result!.systemPrompt).toContain('编排助手');
      expect(result!.systemPrompt).toContain('invoke_agent');
    });

    it('does not double-append orchestrator instruction on repeated calls', () => {
      vi.mocked(agentRepo.findById).mockReturnValue({ ...ORCHESTRATOR_AGENT });
      const first = agentService.findById('orchestrator');
      const second = agentService.findById('orchestrator');
      // Each call builds afresh from the mock, so it's always appended once
      expect(first!.systemPrompt!.match(/编排助手/g)).toHaveLength(1);
      expect(second!.systemPrompt!.match(/编排助手/g)).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('creates an agent with given fields', () => {
      const newAgent: Agent = {
        id: 'new-agent',
        name: 'New Agent',
        description: 'A new agent',
        type: 'custom',
        systemPrompt: 'You are helpful',
        mcpServerIds: [],
        available: true,
        errorMessage: null,
        triggerKeywords: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      vi.mocked(agentRepo.create).mockReturnValue(newAgent);

      const result = agentService.create({
        id: 'new-agent',
        name: 'New Agent',
        description: 'A new agent',
        systemPrompt: 'You are helpful',
      });

      expect(result).toEqual(newAgent);
      expect(agentRepo.create).toHaveBeenCalledWith({
        id: 'new-agent',
        name: 'New Agent',
        description: 'A new agent',
        type: undefined,
        systemPrompt: 'You are helpful',
        mcpServerIds: undefined,
        available: undefined,
        triggerKeywords: undefined,
      });
    });

    it('creates agent with default values when optional fields are omitted', () => {
      vi.mocked(agentRepo.create).mockReturnValue({
        id: 'minimal',
        name: 'Minimal',
        description: '',
        type: 'custom',
        systemPrompt: null,
        mcpServerIds: [],
        available: true,
        errorMessage: null,
        triggerKeywords: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const result = agentService.create({ id: 'minimal', name: 'Minimal' });
      expect(result.id).toBe('minimal');
      expect(result.name).toBe('Minimal');
    });
  });

  describe('update', () => {
    it('updates agent fields', () => {
      const updated: Agent = {
        ...GENERAL_AGENT,
        name: 'Updated Name',
        systemPrompt: 'Updated prompt',
      };
      vi.mocked(agentRepo.update).mockReturnValue(updated);

      const result = agentService.update('general', {
        name: 'Updated Name',
        systemPrompt: 'Updated prompt',
      });

      expect(result).toEqual(updated);
      expect(agentRepo.update).toHaveBeenCalledWith('general', {
        name: 'Updated Name',
        systemPrompt: 'Updated prompt',
      });
    });

    it('updates triggerKeywords', () => {
      vi.mocked(agentRepo.update).mockReturnValue({
        ...CUSTOM_AGENT,
        triggerKeywords: ['hello', 'world'],
      });

      const result = agentService.update('my-custom', {
        triggerKeywords: ['hello', 'world'],
      });

      expect(result!.triggerKeywords).toEqual(['hello', 'world']);
    });
  });

  describe('remove', () => {
    it('deletes an agent by id', () => {
      vi.mocked(agentRepo.deleteById).mockReturnValue({ changes: 1 });
      const result = agentService.remove('my-custom');
      expect(result).toEqual({ changes: 1 });
      expect(agentRepo.deleteById).toHaveBeenCalledWith('my-custom');
    });
  });
});
