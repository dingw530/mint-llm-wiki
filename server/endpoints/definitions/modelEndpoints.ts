import * as endpointService from '../../services/api/endpointService.js';
import * as settingsRepo from '../../repositories/settingsRepository.js';
import type { EndpointDescriptor } from '../types.js';
import type { EndpointInput } from '../../types.js';
import * as modelConnectionService from '../../services/api/modelConnectionService.js';

function toEndpointInput(data: Record<string, unknown>): EndpointInput {
  return {
    name: typeof data.name === 'string' ? data.name : '',
    apiUrl: typeof data.apiUrl === 'string' ? data.apiUrl : '',
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : undefined,
    modelId: typeof data.modelId === 'string' ? data.modelId : '',
    apiType: typeof data.apiType === 'string' ? data.apiType : undefined,
  };
}

function toConnectionInput(data: Record<string, unknown>): modelConnectionService.ConnectionInput {
  return {
    apiUrl: typeof data.apiUrl === 'string' ? data.apiUrl : '',
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : undefined,
    modelId: typeof data.modelId === 'string' ? data.modelId : '',
    apiType: typeof data.apiType === 'string' ? data.apiType : undefined,
  };
}

async function testAndSaveConnection(data: Record<string, unknown>) {
  const input = toConnectionInput(data);
  const endpointId = typeof data.endpointId === 'string' ? data.endpointId : undefined;
  const existing = endpointId ? endpointService.getById(endpointId) : null;
  const keyForTest =
    input.apiKey || (endpointId ? endpointService.getAiConfig(endpointId)?.apiKey : undefined);
  const result = await modelConnectionService.testConnection({ ...input, apiKey: keyForTest });
  if (!result.success) return result;

  const endpointInput = toEndpointInput({ ...data, apiKey: input.apiKey });
  const endpoint = existing
    ? endpointService.updateEndpoint(endpointId!, endpointInput)
    : endpointService.create(endpointInput);
  return { success: true, endpoint: endpointService.markVerified(endpoint.id) };
}

export const modelEndpointsEndpoints: EndpointDescriptor[] = [
  {
    id: 'endpoints:listModels',
    method: 'POST',
    path: '/models',
    preloadMethod: 'listEndpointModels',
    service: (data: Record<string, unknown>) =>
      modelConnectionService.listModels(toConnectionInput(data)),
    args: [{ from: 'body' }],
    result: 'direct',
    async: true,
  },
  {
    id: 'endpoints:testConnection',
    method: 'POST',
    path: '/test',
    preloadMethod: 'testEndpointConnection',
    service: testAndSaveConnection,
    args: [{ from: 'body' }],
    result: 'direct',
    async: true,
  },
  {
    id: 'endpoints:list',
    method: 'GET',
    path: '/',
    preloadMethod: 'getEndpoints',
    service: () => {
      // 首次调用时尝试迁移旧版配置
      try {
        const legacy = settingsRepo.getAll();
        endpointService.migrateLegacyEndpoint({
          apiUrl: legacy.apiUrl,
          apiKey: legacy.apiKey,
          modelId: legacy.modelId,
        });
      } catch {
        /* 迁移失败不影响列表返回 */
      }
      return endpointService.list();
    },
    result: 'direct',
  },
  {
    id: 'endpoints:create',
    method: 'POST',
    path: '/',
    preloadMethod: 'createEndpoint',
    service: (data: Record<string, unknown>) => {
      const endpoint = endpointService.create(toEndpointInput(data));
      return { endpoint };
    },
    args: [{ from: 'body' }],
    result: 'direct',
  },
  {
    id: 'endpoints:update',
    method: 'PUT',
    path: '/:id',
    preloadMethod: 'updateEndpoint',
    service: (id: string, data: Record<string, unknown>) => {
      const endpoint = endpointService.updateEndpoint(id, toEndpointInput(data));
      return { endpoint };
    },
    args: [{ from: 'path', name: 'id' }, { from: 'body' }],
    result: 'direct',
  },
  {
    id: 'endpoints:delete',
    method: 'DELETE',
    path: '/:id',
    preloadMethod: 'deleteEndpoint',
    service: (id: string) => {
      endpointService.remove(id);
      return { success: true };
    },
    args: [{ from: 'path', name: 'id' }],
    result: 'direct',
  },
  {
    id: 'endpoints:activate',
    method: 'PUT',
    path: '/:id/activate',
    preloadMethod: 'activateEndpoint',
    service: (id: string) => {
      endpointService.activate(id);
      return { success: true };
    },
    args: [{ from: 'path', name: 'id' }],
    result: 'direct',
  },
];
