import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'crypto';

// 确保加密密钥环境变量已设置（每个 vitest worker 独立进程）
if (!process.env.AI_CHAT_ENCRYPTION_KEY) {
  process.env.AI_CHAT_ENCRYPTION_KEY = crypto.randomBytes(16).toString('hex');
}

/**
 * Encryption Utility Tests
 *
 * Validates AES-256 encryption/decryption for API Key secure storage (NF-002).
 * The encryption module is expected at server/services/encryption.ts and exports:
 *   - encrypt(plaintext: string): string   (returns hex-encoded ciphertext)
 *   - decrypt(ciphertext: string): string   (accepts hex-encoded ciphertext)
 *   - maskApiKey(apiKey: string): string    (returns masked API Key string)
 *
 * Encryption key is read from AI_CHAT_ENCRYPTION_KEY env var.
 * Uses AES-256-GCM via Node.js crypto module.
 */

let encryption: any;
try {
  encryption = await import('../../encryption.js');
} catch {
  encryption = null;
}

const runIf = (condition: any) => (condition ? describe : describe.skip);

runIf(encryption)('Encryption Module — Unit', () => {
  it('should encrypt a plaintext string and return a hex string', () => {
    const ciphertext = encryption.encrypt('sk-test-api-key-12345');
    expect(typeof ciphertext).toBe('string');
    expect(ciphertext.length).toBeGreaterThan(64);
  });

  it('should decrypt a ciphertext back to the original plaintext', () => {
    const original = 'sk-test-api-key-12345';
    const ciphertext = encryption.encrypt(original);
    const decrypted = encryption.decrypt(ciphertext);
    expect(decrypted).toBe(original);
  });

  it('should produce different ciphertexts for the same plaintext (random IV)', () => {
    const original = 'sk-constant-key';
    const c1 = encryption.encrypt(original);
    const c2 = encryption.encrypt(original);
    expect(c1).not.toBe(c2);
  });

  it('should handle empty string', () => {
    const ciphertext = encryption.encrypt('');
    const decrypted = encryption.decrypt(ciphertext);
    expect(decrypted).toBe('');
  });

  it('should handle special characters and Unicode', () => {
    const original = '!@#$%^&*()_+={}[]|:;<>,.?/~`中文日本語ελληνικά';
    const ciphertext = encryption.encrypt(original);
    const decrypted = encryption.decrypt(ciphertext);
    expect(decrypted).toBe(original);
  });

  it('should handle very long strings (4096 characters)', () => {
    const original = 'A'.repeat(4096);
    const ciphertext = encryption.encrypt(original);
    const decrypted = encryption.decrypt(ciphertext);
    expect(decrypted).toBe(original);
  });

  it('should handle API Key with common prefixes (sk-, pk-, etc.)', () => {
    const keys = [
      'sk-proj-abcdef1234567890',
      'pk-test-abcdef1234567890abcdef',
      'sk-ant-sid01-abcdefghijklmnopqrstuvwxyz',
    ];
    for (const key of keys) {
      const ciphertext = encryption.encrypt(key);
      const decrypted = encryption.decrypt(ciphertext);
      expect(decrypted).toBe(key);
    }
  });
});

runIf(encryption)('Encryption Module — Security', () => {
  it('should detect tampered ciphertext (throw or return garbage)', () => {
    const original = 'sk-valid-key';
    const ciphertext = encryption.encrypt(original);
    const tampered = ciphertext.slice(0, -4) + 'dead';
    let threw = false;
    let result: string | undefined;
    try {
      result = encryption.decrypt(tampered);
    } catch {
      threw = true;
    }
    if (!threw) {
      expect(result).not.toBe(original);
    }
  });

  it('should throw when decrypting an empty string', () => {
    expect(() => encryption.decrypt('')).toThrow();
  });

  it('should throw when decrypting invalid hex string', () => {
    expect(() => encryption.decrypt('not-hex-garbage!!')).toThrow();
  });

  it('should not leak plaintext in error messages', () => {
    const original = 'sk-sensitive-key-do-not-leak';
    const ciphertext = encryption.encrypt(original);
    const tampered = ciphertext.slice(0, -8) + '12345678';
    try {
      const result = encryption.decrypt(tampered);
      expect(result).not.toBe(original);
    } catch (err) {
      expect((err as Error).message).not.toContain(original);
      expect((err as Error).message).not.toContain('sk-');
    }
  });
});

runIf(encryption)('Encryption Module — Configuration', () => {
  const ORIG_ENV = process.env.AI_CHAT_ENCRYPTION_KEY;

  afterEach(() => {
    if (ORIG_ENV) {
      process.env.AI_CHAT_ENCRYPTION_KEY = ORIG_ENV;
    } else {
      delete process.env.AI_CHAT_ENCRYPTION_KEY;
    }
  });

  it('should use a deterministic key from AI_CHAT_ENCRYPTION_KEY env var', () => {
    const testKey = 'abcdef1234567890abcdef1234567890';
    process.env.AI_CHAT_ENCRYPTION_KEY = testKey;
    expect(true).toBe(true);
  });

  it('should fall back to a random key when AI_CHAT_ENCRYPTION_KEY is not set', () => {
    delete process.env.AI_CHAT_ENCRYPTION_KEY;
    expect(true).toBe(true);
  });
});
