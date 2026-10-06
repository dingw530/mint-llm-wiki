import { getDb } from '../db.js';
import type { PersistedUiBlock, UiBlockRow } from '../types.js';
import type { A2UIComponentRegistration } from '../infrastructure/transports/a2ui/types.js';

interface RegistrationRow {
  kind: string;
  catalog_id: string;
  component_name: string;
  data_schema_version: number;
  data_schema: string;
  enabled: number;
}

function mapRegistration(row: RegistrationRow): A2UIComponentRegistration {
  let dataSchema: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.data_schema);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      dataSchema = parsed as Record<string, unknown>;
  } catch {
    // Invalid registration data is treated as disabled by the caller.
  }
  return {
    kind: row.kind,
    catalogId: row.catalog_id,
    componentName: row.component_name,
    dataSchemaVersion: row.data_schema_version,
    dataSchema,
    enabled: row.enabled === 1,
  };
}

/** 读取一个启用的服务端 A2UI 组件契约。 */
export function findComponentRegistration(kind: string): A2UIComponentRegistration | null {
  const row = getDb()
    .prepare(
      `
    SELECT kind, catalog_id, component_name, data_schema_version, data_schema, enabled
    FROM a2ui_component_registry
    WHERE kind = ? AND enabled = 1
  `,
    )
    .get(kind) as RegistrationRow | undefined;
  return row ? mapRegistration(row) : null;
}

/** 读取一条消息的业务 UI Block，按回答中的出现顺序返回。 */
export function findUiBlocksByMessageId(messageId: string): PersistedUiBlock[] {
  const rows = getDb()
    .prepare(
      `
    SELECT id, message_id, block_index, kind, version, data_json, created_at, updated_at
    FROM message_ui_blocks
    WHERE message_id = ?
    ORDER BY block_index ASC
  `,
    )
    .all(messageId) as UiBlockRow[];
  return rows.flatMap((row) => {
    try {
      const data: unknown = JSON.parse(row.data_json);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
      const blockData = data as Record<string, unknown>;
      const textOffset = typeof blockData.textOffset === 'number' ? blockData.textOffset : 0;
      return [
        {
          id: row.id,
          messageId: row.message_id,
          blockIndex: row.block_index,
          textOffset,
          kind: row.kind,
          version: row.version,
          data: blockData,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      ];
    } catch {
      console.error('[a2ui] invalid persisted UI block', {
        messageId,
        blockId: row.id,
        kind: row.kind,
      });
      return [];
    }
  });
}

/** 尽力保存一条回答的业务 UI Block；调用方负责隔离失败。 */
export function createUiBlock(block: PersistedUiBlock): void {
  getDb()
    .prepare(
      `
    INSERT INTO message_ui_blocks (id, message_id, block_index, kind, version, data_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      block.id,
      block.messageId,
      block.blockIndex,
      block.kind,
      block.version,
      JSON.stringify(block.data),
      block.createdAt,
      block.updatedAt,
    );
}
