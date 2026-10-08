import type { Agent } from '@/types';
import { callEndpoint } from '../api/_base';

export function fetchAgents(): Promise<{ agents: Agent[] }> {
  return callEndpoint('agents:list');
}

export function createAgent(data: Partial<Agent>): Promise<{ agent: Agent }> {
  return callEndpoint('agents:create', data);
}

export function updateAgent(id: string, data: Partial<Agent>): Promise<{ agent: Agent }> {
  return callEndpoint('agents:update', id, data);
}

export function deleteAgent(id: string): Promise<{ success: boolean }> {
  return callEndpoint('agents:delete', id);
}
