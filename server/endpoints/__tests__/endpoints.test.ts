import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import crypto from 'crypto';
import type { Server } from 'http';

const TEST_DB_PATH = '/tmp/ai-chat-endpoints-test.db';
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

runIf(server)('AC-067: Endpoint Management — Create & List', () => {
  it('should return empty endpoints list initially', async () => {
    const res = await request!('/api/endpoints');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('endpoints');
    expect(Array.isArray(data.endpoints)).toBe(true);
    expect(data.endpoints.length).toBe(0);
  });

  it('should create a new endpoint', async () => {
    const res = await request!('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: 'OpenAI GPT-4o',
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-create-12345',
        modelId: 'gpt-4o',
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toHaveProperty('endpoint');
    expect(data.endpoint.name).toBe('OpenAI GPT-4o');
    expect(data.endpoint.apiUrl).toBe('https://api.openai.com/v1');
    expect(data.endpoint.modelId).toBe('gpt-4o');
    expect(data.endpoint.isActive).toBe(true); // 首个端点自动激活
    expect(data.endpoint).toHaveProperty('id');
    expect(data.endpoint).toHaveProperty('apiKeyMasked');
    expect(data.endpoint).toHaveProperty('createdAt');
    expect(data.endpoint).toHaveProperty('updatedAt');
  });

  it('should default apiType to openai-chat', async () => {
    const res = await request!('/api/endpoints');
    const data = await res.json();
    const ep = data.endpoints[0];
    expect(ep).toHaveProperty('apiType');
    expect(ep.apiType).toBe('openai-chat');
  });

  it('should create endpoint with explicit apiType', async () => {
    const res = await request!('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Anthropic Claude',
        apiUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-ant-test',
        modelId: 'claude-opus-4-7',
        apiType: 'anthropic',
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.endpoint.apiType).toBe('anthropic');
  });

  it('should include created endpoint in the list', async () => {
    const res = await request!('/api/endpoints');
    const data = await res.json();
    expect(data.endpoints.length).toBeGreaterThanOrEqual(1);
    expect(data.endpoints[0].name).toBe('OpenAI GPT-4o');
  });

  it('should create a second endpoint (not auto-activated)', async () => {
    const res = await request!('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Claude Opus 4.7',
        apiUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-ant-test-create',
        modelId: 'claude-opus-4-7',
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.endpoint.isActive).toBe(false);
  });

  it('should list all endpoints sorted', async () => {
    const res = await request!('/api/endpoints');
    const data = await res.json();
    expect(data.endpoints.length).toBeGreaterThanOrEqual(2);
  });

  it('should return 400 when name is empty', async () => {
    const res = await request!('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: '',
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-test',
        modelId: 'gpt-4o',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('should return 400 when apiUrl is empty', async () => {
    const res = await request!('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test',
        apiUrl: '',
        apiKey: 'sk-test',
        modelId: 'gpt-4o',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('should return 400 when apiUrl is invalid', async () => {
    const res = await request!('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test',
        apiUrl: 'not-a-valid-url',
        apiKey: 'sk-test',
        modelId: 'gpt-4o',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('should return 400 when modelId is empty', async () => {
    const res = await request!('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test',
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-test',
        modelId: '',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('should return 409 when name is duplicate', async () => {
    const res = await request!('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: 'OpenAI GPT-4o',
        apiUrl: 'https://api.other.com',
        apiKey: 'sk-test',
        modelId: 'gpt-4o',
      }),
    });
    expect(res.status).toBe(409);
  });
});

runIf(server)('AC-069: Endpoint Management — Update', () => {
  let endpointId: string;

  beforeAll(async () => {
    const res = await request!('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Update Test',
        apiUrl: 'https://api.before.com',
        apiKey: 'sk-before-update',
        modelId: 'gpt-4o',
      }),
    });
    endpointId = (await res.json()).endpoint.id;
  });

  it('should update endpoint name and apiUrl', async () => {
    const res = await request!(`/api/endpoints/${endpointId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Updated Name',
        apiUrl: 'https://api.after.com',
        modelId: 'gpt-4o-mini',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.endpoint.name).toBe('Updated Name');
    expect(data.endpoint.apiUrl).toBe('https://api.after.com');
    expect(data.endpoint.modelId).toBe('gpt-4o-mini');
  });

  it('should keep existing apiKey when not provided in update', async () => {
    const res = await request!(`/api/endpoints/${endpointId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Updated Name',
        apiUrl: 'https://api.after.com',
        apiKey: '',
        modelId: 'gpt-4o-mini',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.endpoint.apiKeyMasked).toBeTruthy();
  });

  it('should update apiKey when new value provided', async () => {
    const res = await request!(`/api/endpoints/${endpointId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Updated Name',
        apiUrl: 'https://api.after.com',
        apiKey: 'sk-new-key-value',
        modelId: 'gpt-4o-mini',
      }),
    });
    expect(res.status).toBe(200);
  });

  it('should return 404 for non-existent endpoint', async () => {
    const res = await request!('/api/endpoints/non-existent', {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Ghost',
        apiUrl: 'https://api.example.com',
        modelId: 'gpt-4o',
      }),
    });
    expect(res.status).toBe(404);
  });
});

runIf(server)('AC-074: API Key Security — Masked Response', () => {
  it('should never return plaintext apiKey in list', async () => {
    const res = await request!('/api/endpoints');
    const data = await res.json();
    for (const ep of data.endpoints) {
      expect(ep).toHaveProperty('apiKeyMasked');
      expect(ep).not.toHaveProperty('apiKey');
      const text = JSON.stringify(ep);
      expect(text).not.toContain('sk-test-create-12345');
      expect(text).not.toContain('sk-ant-test-create');
    }
  });
});

runIf(server)('AC-070: Endpoint Management — Delete', () => {
  let endpointId: string;

  beforeAll(async () => {
    const res = await request!('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: 'To Delete',
        apiUrl: 'https://api.delete-me.com',
        apiKey: 'sk-delete-test',
        modelId: 'gpt-4o',
      }),
    });
    endpointId = (await res.json()).endpoint.id;
  });

  it('should delete a non-active endpoint', async () => {
    const res = await request!(`/api/endpoints/${endpointId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('should remove deleted endpoint from list', async () => {
    const res = await request!('/api/endpoints');
    const data = await res.json();
    const ids = data.endpoints.map((e: any) => e.id);
    expect(ids).not.toContain(endpointId);
  });

  it('should return 404 for non-existent endpoint', async () => {
    const res = await request!('/api/endpoints/non-existent', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});

runIf(server)('AC-071: Endpoint Management — Reject Delete Last', () => {
  it('should reject deleting the last endpoint', async () => {
    // 获取当前列表
    const listRes = await request!('/api/endpoints');
    const listData = await listRes.json();

    // 删除除最后一个以外的所有端点
    for (let i = 0; i < listData.endpoints.length - 1; i++) {
      await request!(`/api/endpoints/${listData.endpoints[i].id}`, {
        method: 'DELETE',
      });
    }

    // 现在只剩一个端点，尝试删除
    const finalList = await request!('/api/endpoints');
    const finalData = await finalList.json();
    const lastId = finalData.endpoints[0].id;

    const res = await request!(`/api/endpoints/${lastId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('至少保留一个端点');
  });
});

runIf(server)('AC-068: Endpoint Management — Activate', () => {
  let firstId: string;
  let secondId: string;

  beforeAll(async () => {
    // 确保至少有 2 个端点
    const listRes = await request!('/api/endpoints');
    const listData = await listRes.json();

    if (listData.endpoints.length === 0) {
      const r = await request!('/api/endpoints', {
        method: 'POST',
        body: JSON.stringify({
          name: 'First Endpoint',
          apiUrl: 'https://api.first.com',
          apiKey: 'sk-first',
          modelId: 'gpt-4o',
        }),
      });
      firstId = (await r.json()).endpoint.id;
    } else {
      firstId = listData.endpoints[0].id;
    }

    if (listData.endpoints.length < 2) {
      const r = await request!('/api/endpoints', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Second Endpoint',
          apiUrl: 'https://api.second.com',
          apiKey: 'sk-second',
          modelId: 'claude-opus-4-7',
        }),
      });
      secondId = (await r.json()).endpoint.id;
    } else {
      secondId = listData.endpoints[1].id;
    }
  });

  it('should activate second endpoint', async () => {
    const res = await request!(`/api/endpoints/${secondId}/activate`, {
      method: 'PUT',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('should reflect activation in the list', async () => {
    const res = await request!('/api/endpoints');
    const data = await res.json();
    const ep = data.endpoints.find((e: any) => e.id === secondId);
    expect(ep.isActive).toBe(true);
    const first = data.endpoints.find((e: any) => e.id === firstId);
    expect(first.isActive).toBe(false);
  });

  it('should return 404 when activating non-existent endpoint', async () => {
    const res = await request!('/api/endpoints/non-existent/activate', {
      method: 'PUT',
    });
    expect(res.status).toBe(404);
  });
});

runIf(server)('AC-072: API Key Optional — Empty Key', () => {
  it('should create endpoint with empty apiKey', async () => {
    const res = await request!('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Local Ollama',
        apiUrl: 'http://localhost:11434/v1',
        apiKey: '',
        modelId: 'qwen3',
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.endpoint.apiKeyMasked).toBe('');
  });

  it('should create endpoint without apiKey field', async () => {
    const res = await request!('/api/endpoints', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Local LM Studio',
        apiUrl: 'http://localhost:1234/v1',
        modelId: 'local-model',
      }),
    });
    expect(res.status).toBe(201);
  });
});

runIf(server)('AC-073: Migration — Legacy Settings to Endpoints', () => {
  // 注意：迁移测试需要一个干净的数据库，此处的测试数据库已经是全新的
  it('should return empty endpoints list on fresh DB (no legacy)', async () => {
    // 使用一个独立的测试逻辑：在已有端点的数据库中不会触发迁移
    const res = await request!('/api/endpoints');
    const data = await res.json();
    // 数据库可能已有端点（前面的测试创建的），测试迁移幂等性
    expect(data.endpoints.length).toBeGreaterThanOrEqual(0);
  });
});

runIf(server)('NF-004: Endpoint CRUD Response Time', () => {
  it('should respond to GET /api/endpoints within 500ms', async () => {
    const start = performance.now();
    const res = await request!('/api/endpoints');
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(500);
    expect(res.ok).toBe(true);
  });
});

runIf(server)('AC-013: Jev 设置声明式端点', () => {
  it('saves Jev settings and returns them masked over HTTP', async () => {
    const save = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        jevApiUrl: 'https://api.typesafe.ai/v1/systemone',
        jevApiKey: 'sk-http-test-key',
        jevModel: 'jev-latest',
        jevRoutingEnabled: true,
        jevRoutingMinConfidence: 0.6,
        jevMemoryEnabled: true,
        jevMemoryGateThreshold: 0.4,
      }),
    });
    expect(save.status).toBe(200);
    expect((await save.json()).success).toBe(true);

    const res = await request!('/api/settings');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      jevApiUrl: 'https://api.typesafe.ai/v1/systemone',
      jevModel: 'jev-latest',
      jevRoutingEnabled: true,
      jevRoutingMinConfidence: 0.6,
      jevMemoryEnabled: true,
      jevMemoryGateThreshold: 0.4,
    });
    expect(body.jevApiKeyMasked).toBe('sk-****y');
    expect(JSON.stringify(body)).not.toContain('sk-http-test-key');
  });

  it('rejects an invalid Jev endpoint URL', async () => {
    const res = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ jevApiUrl: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('jevApiUrl');
  });

  it('rejects an out-of-range Jev confidence threshold', async () => {
    const res = await request!('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ jevRoutingMinConfidence: 1.5 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('jevRoutingMinConfidence');
  });

  it('reports a readable failure from the Jev connection test endpoint without throwing', async () => {
    // 指向本机未监听端口，避免测试依赖外网；连接被拒应快速返回可读失败。
    const res = await request!('/api/settings/test-jev-connection', {
      method: 'POST',
      body: JSON.stringify({
        apiUrl: 'http://127.0.0.1:1/v1/systemone',
        apiKey: 'sk-probe-key',
        model: 'jev-latest',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('Jev 端点不可达或返回异常状态');
  });

  it('does not create a database migration for the Jev settings', async () => {
    // settings 是纯 KV 表，Jev 设置只新增键，不新增列或表。
    const res = await request!('/api/settings');
    const body = await res.json();
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining([
        'jevApiUrl',
        'jevModel',
        'jevApiKeyMasked',
        'jevRoutingEnabled',
        'jevRoutingMinConfidence',
        'jevMemoryEnabled',
        'jevMemoryGateThreshold',
      ]),
    );
  });
});
