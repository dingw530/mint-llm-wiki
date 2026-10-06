import type { EndpointDescriptor, ManifestEntry } from './types.js';
import { createLogger } from '../infrastructure/observability/logger.js';

const log = createLogger('endpoint-registry');

// ── Endpoint 注册表 ──

export class EndpointRegistry {
  private endpoints = new Map<string, EndpointDescriptor>();
  private byResource = new Map<string, EndpointDescriptor[]>();

  /**
   * 注册单个 endpoint
   */
  register(desc: EndpointDescriptor): void {
    if (this.endpoints.has(desc.id)) {
      log.warn(`Endpoint ${desc.id} already registered, overwriting`);
    }
    this.endpoints.set(desc.id, desc);

    // 按资源分组（id 格式为 'resource:action'）
    const resource = desc.id.split(':')[0];
    if (!this.byResource.has(resource)) {
      this.byResource.set(resource, []);
    }
    this.byResource.get(resource)!.push(desc);

    log.debug(`Registered endpoint: ${desc.id}`);
  }

  /**
   * 批量注册
   */
  registerAll(descriptors: EndpointDescriptor[]): void {
    for (const desc of descriptors) {
      this.register(desc);
    }
  }

  /**
   * 按资源名注册
   */
  registerByResource(resource: string, descriptors: EndpointDescriptor[]): void {
    for (const desc of descriptors) {
      this.register(desc);
    }
  }

  /**
   * 获取单个 endpoint
   */
  get(id: string): EndpointDescriptor | undefined {
    return this.endpoints.get(id);
  }

  /**
   * 获取某个资源下的所有 endpoints
   */
  getByResource(resource: string): EndpointDescriptor[] {
    return this.byResource.get(resource) || [];
  }

  /**
   * 获取所有 endpoints
   */
  all(): EndpointDescriptor[] {
    return Array.from(this.endpoints.values());
  }

  /**
   * 获取所有资源名
   */
  resources(): string[] {
    return Array.from(this.byResource.keys());
  }

  /**
   * 生成 manifest（JSON 序列化格式，供 preload 和前端消费）
   */
  toManifest(): ManifestEntry[] {
    return this.all().map((desc) => ({
      id: desc.id,
      ipcChannel: desc.ipcChannel || desc.id,
      preloadMethod: desc.preloadMethod || null,
      method: desc.method,
      httpPath: desc.path,
      args: desc.args || [],
      result: typeof desc.result === 'string' ? desc.result : null,
      async: desc.async || false,
    }));
  }

  /**
   * 统计信息
   */
  getStats(): { total: number; byResource: Record<string, number> } {
    const byResource: Record<string, number> = {};
    for (const [resource, endpoints] of this.byResource) {
      byResource[resource] = endpoints.length;
    }
    return { total: this.endpoints.size, byResource };
  }
}

// 单例
export const endpointRegistry = new EndpointRegistry();
