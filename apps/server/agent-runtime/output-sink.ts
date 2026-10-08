import type { ReactEvent } from './react-events.js';

/** Transport-neutral output boundary consumed by Agent Runtime adapters. */
export interface Sink {
  write(data: string): void;
  writeEvent?(event: ReactEvent): void;
  end(): void;
  readonly headersSent: boolean;
  readonly writableEnded: boolean;
}
