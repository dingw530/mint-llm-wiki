import type { EndpointOutput, EndpointInput } from '@/types';
import { callEndpoint } from '../api/_base';

export interface ModelConnectionInput {
  endpointId?: string;
  name: string;
  apiUrl: string;
  apiKey?: string;
  modelId: string;
  apiType?: string;
}

export interface ModelListResult {
  models: string[];
  available: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  errorCategory?: 'retryable' | 'configuration' | 'unknown';
  errorMessage?: string;
  endpoint?: EndpointOutput;
}

export function listEndpointModels(
  data: Pick<ModelConnectionInput, 'apiUrl' | 'apiKey' | 'modelId' | 'apiType'>,
): Promise<ModelListResult> {
  return callEndpoint('endpoints:listModels', data);
}

export function testEndpointConnection(data: ModelConnectionInput): Promise<ConnectionTestResult> {
  return callEndpoint('endpoints:testConnection', data);
}

export function getEndpoints(): Promise<{ endpoints: EndpointOutput[] }> {
  return callEndpoint('endpoints:list');
}

export function createEndpoint(data: EndpointInput): Promise<{ endpoint: EndpointOutput }> {
  return callEndpoint('endpoints:create', data);
}

export function updateEndpoint(
  id: string,
  data: EndpointInput,
): Promise<{ endpoint: EndpointOutput }> {
  return callEndpoint('endpoints:update', id, data);
}

export function deleteEndpoint(id: string): Promise<{ success: boolean }> {
  return callEndpoint('endpoints:delete', id);
}

export function activateEndpoint(id: string): Promise<{ success: boolean }> {
  return callEndpoint('endpoints:activate', id);
}
