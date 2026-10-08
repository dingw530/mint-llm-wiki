import { v4 as uuidv4 } from 'uuid';
import * as agentService from '../../domains/agents/index.js';
import { httpError } from '../helpers.js';
import type { EndpointDescriptor } from '../types.js';

export const agentsEndpoints: EndpointDescriptor[] = [
  {
    id: 'agents:list',
    method: 'GET',
    path: '/',
    preloadMethod: 'getAgents',
    service: () => ({ agents: agentService.list() }),
    result: 'direct',
  },
  {
    id: 'agents:get',
    method: 'GET',
    path: '/:id',
    preloadMethod: 'getAgent',
    service: (id: string) => {
      const agent = agentService.findById(id);
      if (!agent) throw httpError(404, 'Agent not found');
      return { agent };
    },
    args: [{ from: 'path', name: 'id' }],
    result: 'direct',
  },
  {
    id: 'agents:create',
    method: 'POST',
    path: '/',
    preloadMethod: 'createAgent',
    service: (data: Record<string, unknown>) => {
      if (!data.name) throw httpError(400, 'name is required');
      const id = uuidv4();
      const agent = agentService.create({
        id,
        name: data.name as string,
        description: data.description as string,
        type: (data.type as string) || 'custom',
        systemPrompt: (data.systemPrompt as string) || null,
        mcpServerIds: (data.mcpServerIds as string[]) || [],
        available: data.available !== undefined ? (data.available as boolean) : true,
        triggerKeywords: (data.triggerKeywords as string[]) || [],
      });
      return { agent };
    },
    args: [{ from: 'body' }],
    result: 'direct',
  },
  {
    id: 'agents:update',
    method: 'PUT',
    path: '/:id',
    preloadMethod: 'updateAgent',
    service: (id: string, data: Record<string, unknown>) => {
      const existing = agentService.findById(id);
      if (!existing) throw httpError(404, 'Agent not found');
      const fields: Record<string, unknown> = {};
      for (const key of [
        'name',
        'description',
        'type',
        'systemPrompt',
        'mcpServerIds',
        'available',
        'triggerKeywords',
      ]) {
        if (data[key] !== undefined) fields[key] = data[key];
      }
      // 不允许修改内置 Agent 的 type
      if (existing.type === 'general') {
        delete fields.type;
      }
      const updated = agentService.update(id, fields);
      return { agent: updated };
    },
    args: [{ from: 'path', name: 'id' }, { from: 'body' }],
    result: 'direct',
  },
  {
    id: 'agents:delete',
    method: 'DELETE',
    path: '/:id',
    preloadMethod: 'deleteAgent',
    service: (id: string) => {
      const existing = agentService.findById(id);
      if (!existing) throw httpError(404, 'Agent not found');
      if (existing.type === 'general') {
        throw httpError(403, 'Cannot delete built-in agent');
      }
      agentService.remove(id);
      return { success: true };
    },
    args: [{ from: 'path', name: 'id' }],
    result: 'direct',
  },
];
