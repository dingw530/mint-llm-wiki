import { afterEach, describe, expect, it } from 'vitest';
import { shouldCaptureLangfuseContent } from '../langfuse.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalCaptureContent = process.env.MINT_LANGFUSE_CAPTURE_CONTENT;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalCaptureContent === undefined) delete process.env.MINT_LANGFUSE_CAPTURE_CONTENT;
  else process.env.MINT_LANGFUSE_CAPTURE_CONTENT = originalCaptureContent;
});

describe('Langfuse content capture', () => {
  it('captures model content automatically in development mode', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.MINT_LANGFUSE_CAPTURE_CONTENT;

    expect(shouldCaptureLangfuseContent()).toBe(true);
  });

  it('keeps model content disabled by default outside development mode', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MINT_LANGFUSE_CAPTURE_CONTENT;

    expect(shouldCaptureLangfuseContent()).toBe(false);
  });

  it('honors the explicit capture setting outside development mode', () => {
    process.env.NODE_ENV = 'production';
    process.env.MINT_LANGFUSE_CAPTURE_CONTENT = 'true';

    expect(shouldCaptureLangfuseContent()).toBe(true);
  });
});
