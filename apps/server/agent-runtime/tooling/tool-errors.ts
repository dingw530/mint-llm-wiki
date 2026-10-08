import type { ToolErrorCode } from './tool-contracts.js';

/** An execution error explicitly marked safe to retry by the tool implementation. */
export class ToolRetryableError extends Error {
  readonly retryable = true;

  constructor(
    message: string,
    readonly errorCode: ToolErrorCode = 'TOOL_FAILED',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ToolRetryableError';
  }
}
