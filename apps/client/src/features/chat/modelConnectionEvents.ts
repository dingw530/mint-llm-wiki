export type ModelConnectionEventType =
  | 'first_use_onboarding_shown'
  | 'first_use_onboarding_skipped'
  | 'model_list_loaded'
  | 'model_list_failed'
  | 'connection_test_started'
  | 'connection_test_succeeded'
  | 'connection_test_failed'
  | 'first_message_sent'
  | 'first_response_completed_saved';

interface ModelConnectionEvent {
  type: ModelConnectionEventType;
  at: string;
  errorCategory?: string;
  elapsedMs?: number;
}

const STORAGE_KEY = 'mint-model-connection-events';
const MAX_EVENTS = 100;

/** Records a privacy-safe first-use event in local storage. */
export function recordModelConnectionEvent(
  type: ModelConnectionEventType,
  details: Pick<ModelConnectionEvent, 'errorCategory' | 'elapsedMs'> = {},
): void {
  if (typeof window === 'undefined') return;
  try {
    const previous = readEvents();
    const next = [...previous, { type, at: new Date().toISOString(), ...details }].slice(
      -MAX_EVENTS,
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Local telemetry must never block the product flow.
  }
}

/** Records an event only once for milestones such as the first successful reply. */
export function recordModelConnectionEventOnce(
  type: ModelConnectionEventType,
  details: Pick<ModelConnectionEvent, 'errorCategory' | 'elapsedMs'> = {},
): void {
  if (readEvents().some((event) => event.type === type)) return;
  recordModelConnectionEvent(type, details);
}

function readEvents(): ModelConnectionEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((event): event is ModelConnectionEvent =>
          Boolean(event && typeof event === 'object' && 'type' in event && 'at' in event),
        )
      : [];
  } catch {
    return [];
  }
}
