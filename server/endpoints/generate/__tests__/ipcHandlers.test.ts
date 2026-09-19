import { afterAll, describe, expect, it, vi } from 'vitest';

const TEST_DB_PATH = '/tmp/ai-chat-ipc-handlers-test.db';

process.env.NODE_ENV = 'test';
process.env.AI_CHAT_DB_PATH = TEST_DB_PATH;
process.env.AI_CHAT_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';

vi.mock('../../../services/api/agentService.js', () => ({
  list: vi.fn(() => []),
  findById: vi.fn(() => null),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../../../services/api/settingsService.js', () => ({
  get: vi.fn(() => ({ apiUrl: '', modelId: '' })),
  save: vi.fn(),
}));

const { settingsEndpoints } = await import('../../definitions/settings.js');
const { agentsEndpoints } = await import('../../definitions/agents.js');
const { conversationsIpcOnlyEndpoints } = await import('../../definitions/conversations.js');
const { endpointRegistry } = await import('../../index.js');
const { registerIpcHandlers } = await import('../ipcHandlers.js');

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const { registerElectronIpcHandlers } = require('../../../../electron/ipc');

interface RegisteredHandler {
  (event: unknown, ...args: unknown[]): unknown;
}

afterAll(async () => {
  const fs = await import('node:fs');
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

describe('standard IPC handlers', () => {
  it('registers the complete settings endpoint group', () => {
    const handlers = new Map<string, RegisteredHandler>();
    const ipcMain = {
      handle(channel: string, handler: RegisteredHandler) {
        handlers.set(channel, handler);
      },
    };

    registerIpcHandlers(settingsEndpoints, { settSvc: { get: vi.fn() } }, ipcMain);

    expect([...handlers.keys()]).toEqual([
      'settings:get',
      'settings:save',
      'settings:testEmbeddingConnection',
      'settings:testChromaConnection',
    ]);
  });

  it('keeps service references and validates explicitly provided legacy model fields', async () => {
    const handlers = new Map<string, RegisteredHandler>();
    const ipcMain = {
      handle(channel: string, handler: RegisteredHandler) {
        handlers.set(channel, handler);
      },
    };

    registerIpcHandlers(settingsEndpoints, {}, ipcMain);

    await expect(handlers.get('settings:get')!({})).resolves.toEqual({
      apiUrl: '',
      modelId: '',
    });
    await expect(handlers.get('settings:save')!({}, { apiUrl: '', modelId: '' })).rejects.toThrow(
      'apiUrl must be a valid URL',
    );
  });

  it('allows saving general settings without legacy model fields', async () => {
    const handlers = new Map<string, RegisteredHandler>();
    const ipcMain = {
      handle(channel: string, handler: RegisteredHandler) {
        handlers.set(channel, handler);
      },
    };

    registerIpcHandlers(settingsEndpoints, {}, ipcMain);

    await expect(
      handlers.get('settings:save')!({}, { systemPrompt: 'Be concise' }),
    ).resolves.toEqual({
      success: true,
    });
  });

  it('registers the complete agents endpoint group with shared response shapes', async () => {
    const handlers = new Map<string, RegisteredHandler>();
    const ipcMain = {
      handle(channel: string, handler: RegisteredHandler) {
        handlers.set(channel, handler);
      },
    };

    registerIpcHandlers(agentsEndpoints, {}, ipcMain);

    expect([...handlers.keys()]).toEqual([
      'agents:list',
      'agents:get',
      'agents:create',
      'agents:update',
      'agents:delete',
    ]);

    const listResult = await handlers.get('agents:list')!({});
    expect(listResult).toEqual(expect.objectContaining({ agents: expect.any(Array) }));

    await expect(handlers.get('agents:create')!({}, {})).rejects.toThrow('name is required');
  });

  it('registers every standard Electron endpoint group without duplicate channels', () => {
    const handlers = new Map<string, RegisteredHandler>();
    const ipcMain = {
      handle(channel: string, handler: RegisteredHandler) {
        if (handlers.has(channel)) throw new Error(`duplicate channel: ${channel}`);
        handlers.set(channel, handler);
      },
    };
    const resources = [
      'settings',
      'agents',
      'conversations',
      'endpoints',
      'memories',
      'mcp-servers',
      'bash-security',
      'skills',
      'graph',
      'wiki',
    ];

    for (const resource of resources) {
      registerIpcHandlers(endpointRegistry.getByResource(resource), {}, ipcMain);
    }
    registerIpcHandlers(conversationsIpcOnlyEndpoints, {}, ipcMain);

    expect(handlers.size).toBe(56);
    expect(handlers.has('conversations:rename')).toBe(true);
    expect(handlers.has('conversations:lockAgent')).toBe(true);
    expect(handlers.has('conversations:resolveToolApproval')).toBe(true);
    expect(handlers.has('wiki:updateSchema')).toBe(true);
  });

  it('registers Electron-only handlers outside the standard endpoint registry', () => {
    const channels = new Set<string>();
    const ipcMain = {
      handle(channel: string) {
        channels.add(channel);
      },
    };

    registerElectronIpcHandlers({
      ipcMain,
      services: {},
      dialog: {},
      logger: {},
      getMainWindow: () => null,
    });

    expect([...channels]).toEqual([
      'chat:send',
      'chat:stream-recovery-action',
      'chat:a2ui:subscribe',
      'conversations:generateTitle',
      'messages:list',
      'download-file',
      'wiki:openInObsidian',
      'wiki:upload',
      'wiki:getJobStatus',
    ]);
  });

  it('streams a recovery action through the Electron chat sink', async () => {
    const handlers = new Map<string, RegisteredHandler>();
    const streamRecoveryAction = vi.fn().mockResolvedValue(undefined);
    const IpcSink = vi.fn();
    const ipcMain = {
      handle(channel: string, handler: RegisteredHandler) {
        handlers.set(channel, handler);
      },
    };

    registerElectronIpcHandlers({
      ipcMain,
      services: { msgSvc: { streamRecoveryAction }, sinkMod: { IpcSink } },
      dialog: {},
      logger: { error: vi.fn() },
      getMainWindow: () => null,
    });
    const event = { sender: { send: vi.fn() } };
    await handlers.get('chat:stream-recovery-action')!(event, 'conversation-1', 'action-1');

    expect(IpcSink).toHaveBeenCalledWith(event, 'conversation-1');
    expect(streamRecoveryAction).toHaveBeenCalledWith(
      'conversation-1',
      'action-1',
      expect.anything(),
    );
  });
});
