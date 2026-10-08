import * as fs from 'fs';
import * as path from 'path';
import type { EndpointDescriptor, ManifestEntry } from '../types.js';
import { createLogger } from '../../infrastructure/observability/logger.js';

const log = createLogger('manifest-generator');

// ── 生成 manifest JSON ──

export function generateManifest(
  descriptors: EndpointDescriptor[],
  resourcePrefix: string,
): ManifestEntry[] {
  return descriptors
    .filter((desc) => !desc.stream)
    .map((desc) => ({
      id: desc.id,
      ipcChannel: desc.ipcChannel || desc.id,
      preloadMethod: desc.preloadMethod || null,
      method: desc.method,
      httpPath: `/${resourcePrefix}${desc.path === '/' ? '' : desc.path}`,
      args: desc.args || [],
      result: typeof desc.result === 'string' ? desc.result : null,
      async: desc.async || false,
    }));
}

// ── 写入 manifest 文件 ──

export function writeManifest(
  allDescriptors: EndpointDescriptor[],
  resourcePrefixes: Record<string, string>,
  outputDir: string,
): void {
  const entries: ManifestEntry[] = [];

  for (const desc of allDescriptors) {
    const resource = desc.id.split(':')[0];
    const prefix = resourcePrefixes[resource] || resource;
    entries.push(...generateManifest([desc], prefix));
  }

  const outputPath = path.join(outputDir, 'endpoints-manifest.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');

  log.info(`Wrote manifest with ${entries.length} entries to ${outputPath}`);
}
