export type IngestionResultEvent =
  | { name: 'ingestion_result_detail_opened'; jobId: string; sourceType?: string }
  | { name: 'ingestion_result_page_opened'; jobId: string; path: string; sourceType?: string };

/**
 * 发出摄入结果观测事件，默认通过浏览器事件暴露给宿主或测试环境。
 *
 * @param event 摄入结果用户行为事件
 */
export function emitIngestionResultEvent(event: IngestionResultEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('mint:ingestion-result', { detail: event }));
}
