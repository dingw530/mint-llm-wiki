import { A2uiMessageSchema, MessageProcessor, type Catalog, type ComponentApi, type SurfaceModel } from '@a2ui/web_core/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import type { PersistedUiBlock } from '@/types';

export type A2uiMessage = typeof A2uiMessageSchema._type;
export type A2uiCatalog = Catalog<ReactComponentImplementation>;
export type A2uiSurfaceModel = SurfaceModel<ReactComponentImplementation>;

/** 解析并校验官方 A2UI v0.9 消息，拒绝自定义扁平 envelope。 */
export function parseA2uiMessage(raw: string): A2uiMessage | null {
  try {
    const result = A2uiMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** 创建官方 A2UI processor；Surface、组件树和 Data Model 均由官方模型管理。 */
export function createA2uiProcessor(catalog: A2uiCatalog): MessageProcessor<ReactComponentImplementation> {
  return new MessageProcessor<ReactComponentImplementation>([catalog]);
}

/** 将自定义 Catalog API 约束为官方 ComponentApi，避免业务组件绕过 Catalog 注册。 */
export function createMintComponentApi<Schema extends ComponentApi['schema']>(name: string, schema: Schema): ComponentApi<Schema> {
  return { name, schema };
}

/** 判断来源是否绑定了可展示的 Wiki chunk，而不是整页读取结果。 */
export function isChunkReference(chunkId: string): boolean {
  return chunkId.includes('#chunk:') || chunkId.includes('#claim:');
}

/** 仅返回 chunk 级来源摘要；整页读取或空摘要不参与卡片展示。 */
export function getSourceSnippet(value: unknown): string {
  if (!value || typeof value !== 'object' || !('chunkId' in value) || typeof value.chunkId !== 'string' || !isChunkReference(value.chunkId)) {
    return '';
  }
  if (!('snippet' in value) || typeof value.snippet !== 'string') return '';
  return value.snippet.trim();
}

/** 将持久化业务 Block 恢复为官方 A2UI 消息；未知契约只记录并降级为纯文本。 */
export function buildPersistedA2uiMessages(block: PersistedUiBlock): A2uiMessage[] {
  if (block.kind !== 'wiki_source_reference' || block.version !== 1) {
    console.warn('[a2ui] ignored unsupported persisted block', { kind: block.kind, version: block.version });
    return [];
  }
  const surfaceId = `answer-source-${block.id}`;
  const source = { ...block.data };
  delete source.textOffset;
  return [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: 'mint' } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [{ id: 'root', component: 'SourceReferenceCard', data: { path: '/source' } }],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId, path: '/source', value: source } },
  ];
}
