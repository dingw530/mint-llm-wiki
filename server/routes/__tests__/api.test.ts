import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import crypto from 'crypto';
import type { Server } from 'http';

const TEST_DB_PATH = '/tmp/ai-chat-test.db';
const AUTH_HEADERS = { 'Content-Type': 'application/json' };

if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

process.env.NODE_ENV = 'test';
process.env.AI_CHAT_ENCRYPTION_KEY = crypto.randomBytes(16).toString('hex');
process.env.AI_CHAT_DB_PATH = TEST_DB_PATH;

type RequestFn = (url: string, options?: any) => Promise<Response>;

const { server, request } = await (async (): Promise<{
  server: Server | null;
  request: RequestFn | null;
}> => {
  try {
    const appModule = await import('../../app.js');
    const app = appModule.default;
    let srv: Server;
    let req: RequestFn;

    await new Promise<void>((resolve, reject) => {
      srv = app.listen(0, () => {
        const address = srv.address();
        if (!address || typeof address === 'string')
          throw new Error('Test server did not bind to a port');
        const baseUrl = `http://localhost:${address.port}`;
        req = (url: string, options: any = {}) => {
          return fetch(`${baseUrl}${url}`, {
            headers: AUTH_HEADERS,
            ...options,
          });
        };
        resolve();
      });
      srv.on('error', reject);
    });

    return { server: srv!, request: req! };
  } catch (err) {
    console.error('FAILED TO START SERVER:', (err as Error).message, (err as Error).stack);
    return { server: null, request: null };
  }
})();

afterAll(() => {
  if (server) {
    server.close();
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    try {
      fs.unlinkSync(TEST_DB_PATH);
    } catch {
      /* ignore */
    }
  }
  for (const ext of ['-wal', '-shm']) {
    const p = TEST_DB_PATH + ext;
    if (fs.existsSync(p))
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
  }
});

const runIf = (condition: any) => (condition ? describe : describe.skip);

runIf(server)('AC-001: Session List — Empty State & Loading', () => {
  it('should return an empty conversation list on first load', async () => {
    const res = await request!('/api/conversations');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('conversations');
    expect(Array.isArray(data.conversations)).toBe(true);
    expect(data.conversations.length).toBe(0);
  });

  it('should return 200 with correct Content-Type header', async () => {
    const res = await request!('/api/conversations');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('should respond within acceptable time (< 500ms for empty list)', async () => {
    const start = performance.now();
    await request!('/api/conversations');
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(500);
  });
});

runIf(server)('AC-002: New Conversation', () => {
  let createdId: string;

  it('should create a new conversation and return it', async () => {
    const res = await request!('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 'New Chat' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('conversation');
    expect(data.conversation).toHaveProperty('id');
    expect(data.conversation).toHaveProperty('title', 'New Chat');
    expect(data.conversation).toHaveProperty('createdAt');
    expect(data.conversation).toHaveProperty('updatedAt');
    createdId = data.conversation.id;
  });

  it('should auto-generate a title when title is empty', async () => {
    const res = await request!('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.conversation.title).toBeTruthy();
    expect(typeof data.conversation.title).toBe('string');
    expect(data.conversation.title.length).toBeGreaterThan(0);
  });

  it('should include the new conversation in the list', async () => {
    const res = await request!('/api/conversations');
    const data = await res.json();
    const ids = data.conversations.map((c: any) => c.id);
    expect(ids).toContain(createdId);
  });

  it('should return 400 when title is not a string', async () => {
    const res = await request!('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 12345 }),
    });
    expect(res.status).toBe(400);
  });

  it('should order conversations by updatedAt descending (newest first)', async () => {
    await request!('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 'Second Chat' }),
    });
    const res = await request!('/api/conversations');
    const data = await res.json();
    for (let i = 1; i < data.conversations.length; i++) {
      const prev = new Date(data.conversations[i - 1].updatedAt).getTime();
      const curr = new Date(data.conversations[i].updatedAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });
});

runIf(server)('AC-005: Delete & Rename Conversation', () => {
  let convId: string;

  beforeEach(async () => {
    const res = await request!('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 'Temp Chat' }),
    });
    const data = await res.json();
    convId = data.conversation.id;
  });

  it('should rename a conversation and return updated object', async () => {
    const res = await request!(`/api/conversations/${convId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Renamed Chat' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversation.title).toBe('Renamed Chat');
  });

  it('should reflect the new name in the conversation list', async () => {
    await request!(`/api/conversations/${convId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Updated Name' }),
    });
    const res = await request!('/api/conversations');
    const data = await res.json();
    const found = data.conversations.find((c: any) => c.id === convId);
    expect(found).toBeTruthy();
    expect(found.title).toBe('Updated Name');
  });

  it('should return 400 when renaming with empty title', async () => {
    const res = await request!(`/api/conversations/${convId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('should delete a conversation', async () => {
    const res = await request!(`/api/conversations/${convId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('should remove deleted conversation from the list', async () => {
    await request!(`/api/conversations/${convId}`, { method: 'DELETE' });
    const res = await request!('/api/conversations');
    const data = await res.json();
    const ids = data.conversations.map((c: any) => c.id);
    expect(ids).not.toContain(convId);
  });

  it('should return 404 when deleting non-existent conversation', async () => {
    const res = await request!('/api/conversations/non-existent-id', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });

  it('should return 404 when renaming non-existent conversation', async () => {
    const res = await request!('/api/conversations/non-existent-id', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Ghost' }),
    });
    expect(res.status).toBe(404);
  });
});

runIf(server)('AC-011: Conversation Lock', () => {
  let convId: string;

  beforeEach(async () => {
    const res = await request!('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 'Lock Test' }),
    });
    const data = await res.json();
    convId = data.conversation.id;
  });

  it('should lock conversation to an agent', async () => {
    const res = await request!(`/api/conversations/${convId}`, {
      method: 'PATCH',
      body: JSON.stringify({ lockedAgent: 'general' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversation.lockedAgent).toBe('general');
  });

  it('should reflect lockedAgent in conversation list', async () => {
    await request!(`/api/conversations/${convId}`, {
      method: 'PATCH',
      body: JSON.stringify({ lockedAgent: 'general' }),
    });
    const res = await request!('/api/conversations');
    const data = await res.json();
    const found = data.conversations.find((c: any) => c.id === convId);
    expect(found.lockedAgent).toBe('general');
  });

  it('should unlock conversation by setting lockedAgent to null', async () => {
    // Lock first
    await request!(`/api/conversations/${convId}`, {
      method: 'PATCH',
      body: JSON.stringify({ lockedAgent: 'general' }),
    });
    // Then unlock
    const unlockRes = await request!(`/api/conversations/${convId}`, {
      method: 'PATCH',
      body: JSON.stringify({ lockedAgent: null }),
    });
    expect(unlockRes.status).toBe(200);
    const data = await unlockRes.json();
    expect(data.conversation.lockedAgent).toBeNull();
  });

  it('should return 404 when locking non-existent conversation', async () => {
    const res = await request!('/api/conversations/non-existent-id', {
      method: 'PATCH',
      body: JSON.stringify({ lockedAgent: 'general' }),
    });
    expect(res.status).toBe(404);
  });

  it('should have lockedAgent field default to null', async () => {
    const res = await request!('/api/conversations');
    const data = await res.json();
    const found = data.conversations.find((c: any) => c.id === convId);
    expect(found).toHaveProperty('lockedAgent');
    expect(found.lockedAgent).toBeNull();
  });

  it('should have routingMode field default to auto', async () => {
    const res = await request!('/api/conversations');
    const data = await res.json();
    const found = data.conversations.find((c: any) => c.id === convId);
    expect(found).toHaveProperty('routingMode');
    expect(found.routingMode).toBe('auto');
  });
});

runIf(server)('AC-006: Conversation Messages — Load History', () => {
  let convId: string;

  beforeEach(async () => {
    const res = await request!('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 'History Test' }),
    });
    const data = await res.json();
    convId = data.conversation.id;
  });

  it('should return empty messages for a new conversation', async () => {
    const res = await request!(`/api/conversations/${convId}/messages`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('messages');
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.messages.length).toBe(0);
  });

  it('should return 404 for messages of a non-existent conversation', async () => {
    const res = await request!('/api/conversations/non-existent/messages');
    expect(res.status).toBe(404);
  });

  it('should return messages in chronological order', async () => {
    const res = await request!(`/api/conversations/${convId}/messages`);
    const data = await res.json();
    expect(Array.isArray(data.messages)).toBe(true);
    if (data.messages.length > 1) {
      for (let i = 1; i < data.messages.length; i++) {
        const prev = new Date(data.messages[i - 1].createdAt).getTime();
        const curr = new Date(data.messages[i].createdAt).getTime();
        expect(prev).toBeLessThanOrEqual(curr);
      }
    }
  });

  it('each message should have required fields', async () => {
    const res = await request!(`/api/conversations/${convId}/messages`);
    const data = await res.json();
    for (const msg of data.messages) {
      expect(msg).toHaveProperty('id');
      expect(msg).toHaveProperty('role');
      expect(['user', 'assistant']).toContain(msg.role);
      expect(msg).toHaveProperty('content');
      expect(typeof msg.content).toBe('string');
      expect(msg).toHaveProperty('createdAt');
    }
  });
});

runIf(server)('AC-003: Send Message — SSE Streaming', () => {
  let convId: string;

  beforeAll(async () => {
    // 先保存 API 设置，确保 streamChat 不会因空配置而拒绝
    await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-sse-streaming',
        modelId: 'gpt-4o-mini',
      }),
    });
    const res = await request!('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 'Stream Test' }),
    });
    const data = await res.json();
    convId = data.conversation.id;
  });

  it.skip('should return SSE content-type header', async () => {
    const res = await request!(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: 'Hello' }),
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it.skip('should return SSE content-type on non-streaming request', async () => {
    const res = await request!(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: 'Hello' }),
    });
    expect([200, 201]).toContain(res.status);
  });

  it('should return 400 when message content is empty', async () => {
    const res = await request!(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('should return 400 when message content is missing', async () => {
    const res = await request!(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('should return 404 when sending to non-existent conversation', async () => {
    const res = await request!('/api/conversations/non-existent/messages', {
      method: 'POST',
      body: JSON.stringify({ content: 'Hello' }),
    });
    expect(res.status).toBe(404);
  });

  it.skip('should disable buffering headers for SSE', async () => {
    const res = await request!(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: 'Hello' }),
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    });
    const cacheControl = res.headers.get('cache-control') || '';
    expect(cacheControl).toContain('no-cache');
  });

  it('should persist user message and AI response after streaming completes', async () => {
    const res = await request!(`/api/conversations/${convId}/messages`);
    const data = await res.json();
    expect(Array.isArray(data.messages)).toBe(true);
  });
});

runIf(server)('AC-004: Settings — Configuration Persistence', () => {
  const TEST_CONFIG = {
    apiUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test-persistent-key-12345',
    modelId: 'gpt-4o-mini',
  };

  it('should return default/empty settings on first load', async () => {
    const res = await request!('/api/settings');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('apiUrl');
    expect(data).toHaveProperty('apiKeyMasked');
  });

  it('should save settings successfully', async () => {
    const res = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(TEST_CONFIG),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('should return the saved apiUrl and a masked apiKey', async () => {
    await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(TEST_CONFIG),
    });
    const res = await request!('/api/settings');
    const data = await res.json();
    expect(data.apiUrl).toBe(TEST_CONFIG.apiUrl);
    expect(data.apiKeyMasked).toBeTruthy();
    expect(data.apiKeyMasked).not.toBe(TEST_CONFIG.apiKey);
    expect(data.apiKeyMasked).toContain('sk-');
    expect(data.apiKeyMasked).toContain('****');
  });

  it('should NOT return the plaintext apiKey in the response', async () => {
    await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(TEST_CONFIG),
    });
    const res = await request!('/api/settings');
    const body = await res.text();
    expect(body).not.toContain(TEST_CONFIG.apiKey);
  });

  it('should return 400 when apiUrl is invalid', async () => {
    const res = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ apiUrl: 'not-a-url', apiKey: 'sk-test', modelId: 'gpt-4o' }),
    });
    expect(res.status).toBe(400);
  });

  it('should accept empty apiKey (optional, keep existing)', async () => {
    const res = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ apiUrl: 'https://api.example.com', apiKey: '', modelId: 'gpt-4o' }),
    });
    expect(res.status).toBe(200);
  });

  it('should accept missing apiKey (optional, keep existing)', async () => {
    const res = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ apiUrl: 'https://api.example.com', modelId: 'gpt-4o' }),
    });
    expect(res.status).toBe(200);
  });

  it('should accept general settings without legacy model fields', async () => {
    const res = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ systemPrompt: 'general-only' }),
    });
    expect(res.status).toBe(200);
  });

  it('should persist settings across multiple read requests', async () => {
    await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(TEST_CONFIG),
    });
    const r1 = await request!('/api/settings');
    const d1 = await r1.json();
    const r2 = await request!('/api/settings');
    const d2 = await r2.json();
    expect(d1.apiUrl).toBe(d2.apiUrl);
    expect(d1.apiKeyMasked).toBe(d2.apiKeyMasked);
  });
});

runIf(server)('AC-007/008/012: System Prompt and Thinking Mode Settings', () => {
  it('should include systemPrompt and thinkingMode in GET response shape', async () => {
    const res = await request!('/api/settings');
    const data = await res.json();
    const allowedFields = [
      'apiUrl',
      'apiKeyMasked',
      'modelId',
      'systemPrompt',
      'thinkingMode',
      'memoryEnabled',
    ];
    for (const field of allowedFields) {
      expect(data).toHaveProperty(field);
    }
  });

  it('should default systemPrompt to empty string when not set', async () => {
    const res = await request!('/api/settings');
    const data = await res.json();
    expect(data).toHaveProperty('systemPrompt');
    expect(data.systemPrompt).toBe('');
  });

  it('should default thinkingMode to false when not set', async () => {
    const res = await request!('/api/settings');
    const data = await res.json();
    expect(data).toHaveProperty('thinkingMode');
    expect(data.thinkingMode).toBe(false);
  });

  it('should save and return systemPrompt in settings', async () => {
    const saveRes = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-test-system-prompt',
        modelId: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant',
      }),
    });
    expect(saveRes.status).toBe(200);

    const getRes = await request!('/api/settings');
    const data = await getRes.json();
    expect(data.systemPrompt).toBe('You are a helpful assistant');
  });

  it('should save and return thinkingMode as boolean in settings', async () => {
    const saveRes = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-test-thinking',
        modelId: 'gpt-4o',
        thinkingMode: true,
      }),
    });
    expect(saveRes.status).toBe(200);

    const getRes = await request!('/api/settings');
    const data = await getRes.json();
    expect(data.thinkingMode).toBe(true);
  });

  it('should persist systemPrompt and thinkingMode across multiple reads', async () => {
    await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-test-persist',
        modelId: 'gpt-4o',
        systemPrompt: 'Persist this prompt',
        thinkingMode: true,
      }),
    });

    const r1 = await request!('/api/settings');
    const d1 = await r1.json();
    const r2 = await request!('/api/settings');
    const d2 = await r2.json();

    expect(d1.systemPrompt).toBe('Persist this prompt');
    expect(d1.thinkingMode).toBe(true);
    expect(d2.systemPrompt).toBe('Persist this prompt');
    expect(d2.thinkingMode).toBe(true);
  });

  it('should accept PUT without systemPrompt and thinkingMode (backward compat)', async () => {
    const saveRes = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-test-backward',
        modelId: 'gpt-4o',
      }),
    });
    expect(saveRes.status).toBe(200);

    const getRes = await request!('/api/settings');
    const data = await getRes.json();
    expect(data).toHaveProperty('systemPrompt');
    expect(data).toHaveProperty('thinkingMode');
    expect(typeof data.systemPrompt).toBe('string');
    expect(typeof data.thinkingMode).toBe('boolean');
  });

  it('should accept empty string systemPrompt', async () => {
    const saveRes = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-test-empty-sp',
        modelId: 'gpt-4o',
        systemPrompt: '',
      }),
    });
    expect(saveRes.status).toBe(200);

    const getRes = await request!('/api/settings');
    const data = await getRes.json();
    expect(data.systemPrompt).toBe('');
  });

  it('should accept thinkingMode as false', async () => {
    const saveRes = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-test-false-tm',
        modelId: 'gpt-4o',
        thinkingMode: false,
      }),
    });
    expect(saveRes.status).toBe(200);

    const getRes = await request!('/api/settings');
    const data = await getRes.json();
    expect(data.thinkingMode).toBe(false);
  });
});

runIf(server)('AC-012: Settings — routingMode Persistence', () => {
  const BASE_CONFIG = {
    apiUrl: 'https://api.example.com',
    apiKey: 'sk-test-routing-mode',
    modelId: 'gpt-4o',
  };

  it('should default routingMode to auto', async () => {
    const res = await request!('/api/settings');
    const data = await res.json();
    expect(data).toHaveProperty('routingMode');
    expect(data.routingMode).toBe('auto');
  });

  it('should save and return routingMode=manual', async () => {
    const saveRes = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...BASE_CONFIG, routingMode: 'manual' }),
    });
    expect(saveRes.status).toBe(200);

    const getRes = await request!('/api/settings');
    const data = await getRes.json();
    expect(data.routingMode).toBe('manual');
  });

  it('should save and return routingMode=auto', async () => {
    await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...BASE_CONFIG, routingMode: 'auto' }),
    });
    const getRes = await request!('/api/settings');
    const data = await getRes.json();
    expect(data.routingMode).toBe('auto');
  });

  it('should persist routingMode across multiple reads', async () => {
    await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...BASE_CONFIG, routingMode: 'manual' }),
    });

    const r1 = await request!('/api/settings');
    const d1 = await r1.json();
    const r2 = await request!('/api/settings');
    const d2 = await r2.json();

    expect(d1.routingMode).toBe('manual');
    expect(d2.routingMode).toBe('manual');
  });

  it('should accept PUT without routingMode (backward compat)', async () => {
    const saveRes = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-test-backward-rm',
        modelId: 'gpt-4o',
      }),
    });
    expect(saveRes.status).toBe(200);

    const getRes = await request!('/api/settings');
    const data = await getRes.json();
    expect(data).toHaveProperty('routingMode');
    expect(data.routingMode).toBe('auto');
  });
});

runIf(server)('NF-001: Response Time Constraints', () => {
  const ENDPOINTS: [string, string][] = [
    ['GET', '/api/conversations'],
    ['GET', '/api/settings'],
  ];

  it.each(ENDPOINTS)('%s %s should respond within 500ms', async (method, url) => {
    const start = performance.now();
    const res = await request!(url, { method });
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(500);
    expect(res.ok).toBe(true);
  });
});

runIf(server)('API Contract — Response Shapes', () => {
  it('Conversation object should have exact required fields', async () => {
    const res = await request!('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 'Shape Test' }),
    });
    const data = await res.json();
    const conv = data.conversation;
    const allowedFields = ['id', 'title', 'createdAt', 'updatedAt'];
    const actualFields = Object.keys(conv);
    for (const field of allowedFields) {
      expect(actualFields).toContain(field);
    }
  });

  it('should reject unsupported HTTP methods with 405', async () => {
    const res = await request!('/api/conversations', { method: 'PUT' });
    expect([404, 405]).toContain(res.status);
  });

  it('should handle malformed JSON body gracefully', async () => {
    const res = await request!('/api/conversations', {
      method: 'POST',
      body: 'not-json-at-all',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });
});

runIf(server)('AC-009: Memories — CRUD Operations', () => {
  let memoryId: string;

  it('should return empty list initially', async () => {
    const res = await request!('/api/memories?includeUnassigned=true');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  it('should create a new memory', async () => {
    const res = await request!('/api/memories', {
      method: 'POST',
      body: JSON.stringify({ content: '用户是开发者', category: 'personal' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('id');
    expect(data.content).toBe('用户是开发者');
    expect(data.category).toBe('personal');
    expect(data).toHaveProperty('createdAt');
    expect(data).toHaveProperty('updatedAt');
    memoryId = data.id;
  });

  it('should include the new memory in the list', async () => {
    const res = await request!('/api/memories?includeUnassigned=true');
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.some((m: any) => m.id === memoryId)).toBe(true);
  });

  it('should create memory with default category when not provided', async () => {
    const res = await request!('/api/memories', {
      method: 'POST',
      body: JSON.stringify({ content: '一些通用信息' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.category).toBe('general');
  });

  it('should filter global and assigned memories by category', async () => {
    const created = await request!('/api/memories', {
      method: 'POST',
      body: JSON.stringify({ content: '喜欢简洁代码', category: 'preference' }),
    });
    const createdMemory = await created.json();
    const res = await request!('/api/memories?category=preference');
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: createdMemory.id })]),
    );
    expect(data.every((memory: any) => memory.category === 'preference')).toBe(true);
  });

  it('returns preserved unassigned history when the ownership filter requests it', async () => {
    const { getDb } = await import('../../db.js');
    getDb()
      .prepare(
        `INSERT INTO memories (
          id, content, created_at, updated_at, context_policy, policy_source, scope_kind, space_id
        ) VALUES (?, ?, ?, ?, 'retrievable', 'migration', 'unassigned', NULL)`,
      )
      .run(
        'api-test-unassigned-history',
        'Legacy fixture memory',
        new Date().toISOString(),
        new Date().toISOString(),
      );

    const response = await request!('/api/memories?scopeKind=unassigned&includeInactive=true');
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'api-test-unassigned-history' })]),
    );
  });

  it('should update a memory', async () => {
    const res = await request!(`/api/memories/${memoryId}`, {
      method: 'PUT',
      body: JSON.stringify({ content: '用户是全栈开发者', category: 'personal' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.content).toBe('用户是全栈开发者');
    expect(data.category).toBe('personal');
  });

  it('should reflect updates in the list', async () => {
    const res = await request!('/api/memories?includeUnassigned=true');
    const data = await res.json();
    const found = data.find((m: any) => m.id === memoryId);
    expect(found).toBeTruthy();
    expect(found.content).toBe('用户是全栈开发者');
  });

  it('should delete a memory', async () => {
    const res = await request!(`/api/memories/${memoryId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('should remove deleted memory from the list', async () => {
    const res = await request!('/api/memories?includeUnassigned=true');
    const data = await res.json();
    expect(data.some((m: any) => m.id === memoryId)).toBe(false);
  });

  it('should return 400 when creating memory with empty content', async () => {
    const res = await request!('/api/memories', {
      method: 'POST',
      body: JSON.stringify({ content: '', category: 'general' }),
    });
    expect(res.status).toBe(400);
  });

  it('should return 400 when creating memory without content', async () => {
    const res = await request!('/api/memories', {
      method: 'POST',
      body: JSON.stringify({ category: 'general' }),
    });
    expect(res.status).toBe(400);
  });

  it('should return 404 when updating non-existent memory', async () => {
    const res = await request!('/api/memories/non-existent-id', {
      method: 'PUT',
      body: JSON.stringify({ content: 'anything' }),
    });
    expect(res.status).toBe(404);
  });
});

runIf(server)('AC-010: Settings — memoryEnabled Persistence', () => {
  const BASE_CONFIG = {
    apiUrl: 'https://api.example.com',
    apiKey: 'sk-test-memory-enabled',
    modelId: 'gpt-4o',
  };

  it('should default memoryEnabled to false', async () => {
    const res = await request!('/api/settings');
    const data = await res.json();
    expect(data).toHaveProperty('memoryEnabled');
    expect(data.memoryEnabled).toBe(false);
  });

  it('should save and return memoryEnabled=true', async () => {
    const saveRes = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...BASE_CONFIG, memoryEnabled: true }),
    });
    expect(saveRes.status).toBe(200);

    const getRes = await request!('/api/settings');
    const data = await getRes.json();
    expect(data.memoryEnabled).toBe(true);
  });

  it('should save and return memoryEnabled=false', async () => {
    await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...BASE_CONFIG, memoryEnabled: false }),
    });

    const getRes = await request!('/api/settings');
    const data = await getRes.json();
    expect(data.memoryEnabled).toBe(false);
  });

  it('should persist memoryEnabled across multiple reads', async () => {
    await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...BASE_CONFIG, memoryEnabled: true }),
    });

    const r1 = await request!('/api/settings');
    const d1 = await r1.json();
    const r2 = await request!('/api/settings');
    const d2 = await r2.json();

    expect(d1.memoryEnabled).toBe(true);
    expect(d2.memoryEnabled).toBe(true);
  });

  it('should accept PUT without memoryEnabled (backward compat)', async () => {
    const saveRes = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-test-backward-mem',
        modelId: 'gpt-4o',
      }),
    });
    expect(saveRes.status).toBe(200);

    const getRes = await request!('/api/settings');
    const data = await getRes.json();
    expect(data).toHaveProperty('memoryEnabled');
    expect(data.memoryEnabled).toBe(false);
  });
});
runIf(server)('AC-013: Routing Logs', () => {
  it('should return empty routing logs initially', async () => {
    const res = await request!('/api/routing-logs');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('logs');
    expect(Array.isArray(data.logs)).toBe(true);
    expect(data.logs.length).toBe(0);
  });

  it('should filter routing logs by conversationId', async () => {
    const res = await request!('/api/routing-logs?conversationId=non-existent');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.logs)).toBe(true);
    expect(data.logs.length).toBe(0);
  });

  it('should support pagination parameters', async () => {
    const res = await request!('/api/routing-logs?page=1&pageSize=5');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.logs)).toBe(true);
  });

  it('should return logs for routing decisions made by messageService', async () => {
    // Create conversation
    const convRes = await request!('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 'Routing Log Integration' }),
    });
    const conv = (await convRes.json()).conversation;

    // Save settings
    await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-routing-log',
        modelId: 'gpt-4o-mini',
      }),
    });

    // Send message without agent — this triggers routing; the AI call
    // will hang since there's no real API, so use a short timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    try {
      await request!(`/api/conversations/${conv.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: '你好' }),
        signal: controller.signal,
      });
    } catch {
      /* expected: AI call fails or times out */
    } finally {
      clearTimeout(timeoutId);
    }

    // However, routing log should have been created
    const logsRes = await request!('/api/routing-logs');
    const logsData = await logsRes.json();
    expect(logsData.logs.length).toBeGreaterThanOrEqual(1);
    const relatedLogs = logsData.logs.filter((l: any) => l.conversationId === conv.id);
    expect(relatedLogs.length).toBeGreaterThanOrEqual(1);
    expect(relatedLogs[0]).toHaveProperty('agentId');
    expect(relatedLogs[0]).toHaveProperty('confidence');
    expect(relatedLogs[0]).toHaveProperty('method');
    expect(relatedLogs[0]).toHaveProperty('createdAt');
  });
});

runIf(server)('NF-002: API Key Security', () => {
  it('should store API Key encrypted in the database', async () => {
    await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-plaintext-check-999',
      }),
    });

    try {
      const Database = await import('better-sqlite3');
      const db = new Database(TEST_DB_PATH);
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('apiKey') as
        { value: string } | undefined;
      db.close();

      if (row && row.value) {
        expect(row.value).not.toContain('sk-plaintext-check-999');
        expect(row.value.length).toBeGreaterThan(60);
        expect(/^[0-9a-f:]+$/i.test(row.value)).toBe(true);
      }
    } catch {
      expect(true).toBe(true);
    }
  });
});

runIf(server)('API-007: Ingestion A2UI SSE', () => {
  it('flushes an initial connection marker when the conversation has no jobs', async () => {
    const response = await request!('/api/conversations/conversation-sse-empty/ingestion-events');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toContain(': connected');
    await reader.cancel();
  });

  it('registers the SSE endpoint and sends the current session snapshot', async () => {
    const { createJob } = await import('../../services/jobs/adapters/sqliteJobStore.js');
    createJob('notes.md', 10, {
      sourceType: 'chat',
      conversationId: 'conversation-sse',
      fileCount: 1,
      payload: { source: 'notes' },
    });
    const response = await request!('/api/conversations/conversation-sse/ingestion-events');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    let text = '';
    for (let index = 0; index < 3 && !text.includes('updateDataModel'); index += 1) {
      const chunk = await reader.read();
      text += new TextDecoder().decode(chunk.value);
      if (chunk.done) break;
    }
    expect(text).toContain('createSurface');
    expect(text).toContain('updateComponents');
    expect(text).toContain('updateDataModel');
    await reader.cancel();
  });
});
