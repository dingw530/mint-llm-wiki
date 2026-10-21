import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { registerTrajectoryHandlers } = require('../../../../electron/ipc/trajectory.js');

interface Handler {
  (event: { sender: Sender }, ...args: unknown[]): unknown;
}

interface Sender {
  id: number;
  send: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
}

describe('Electron trajectory IPC', () => {
  it('forwards safe SSE updates and cancels the underlying service stream', async () => {
    const handlers = new Map<string, Handler>();
    let serviceResponse: { write: (chunk: string) => boolean; end: () => void } | undefined;
    const onClose = vi.fn();
    const service = vi.fn((_id, _query, _request, response) => {
      serviceResponse = response;
      response.on('close', onClose);
      response.write(': ready 1\n\n');
      response.write('id: 2\ndata: {"cursor":2,"events":[],"entries":[],"runs":[]}\n\n');
    });
    const sender: Sender = {
      id: 7,
      send: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
    };
    registerTrajectoryHandlers({
      ipcMain: {
        handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
      },
      services: {
        endpointRegistry: {
          getByResource: () => [{ id: 'conversations:streamTrajectory', service }],
        },
      },
    });

    const subscribed = await handlers.get('conversations:subscribeTrajectory')?.(
      { sender },
      'conversation-1',
      1,
    );
    expect(service).toHaveBeenCalledWith(
      'conversation-1',
      { afterSeq: 1 },
      expect.objectContaining({ header: expect.any(Function) }),
      expect.objectContaining({ write: expect.any(Function) }),
    );
    const subscriptionId = (subscribed as { subscriptionId: string }).subscriptionId;
    expect(sender.send).toHaveBeenCalledWith('conversations:trajectoryUpdate', subscriptionId, {
      cursor: 2,
      events: [],
      entries: [],
      runs: [],
    });

    const foreignSender = { ...sender, id: 8 };
    expect(
      handlers.get('conversations:unsubscribeTrajectory')?.(
        { sender: foreignSender },
        subscriptionId,
      ),
    ).toEqual({ unsubscribed: false });
    expect(
      handlers.get('conversations:unsubscribeTrajectory')?.({ sender }, subscriptionId),
    ).toEqual({ unsubscribed: true });
    expect(onClose).toHaveBeenCalledOnce();
    expect(sender.removeListener).toHaveBeenCalledWith('destroyed', expect.any(Function));
    expect(serviceResponse).toBeDefined();
  });

  it('closes the service stream when the renderer is destroyed', async () => {
    const handlers = new Map<string, Handler>();
    let rendererDestroyed: (() => void) | undefined;
    const onClose = vi.fn();
    const sender: Sender = {
      id: 9,
      send: vi.fn(),
      once: vi.fn((event: string, listener: () => void) => {
        if (event === 'destroyed') rendererDestroyed = listener;
      }),
      removeListener: vi.fn(),
    };
    registerTrajectoryHandlers({
      ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
      services: {
        endpointRegistry: {
          getByResource: () => [
            {
              id: 'conversations:streamTrajectory',
              service: (_id, _query, _request, response) => response.on('close', onClose),
            },
          ],
        },
      },
    });

    await handlers.get('conversations:subscribeTrajectory')?.({ sender }, 'conversation-1', 0);
    rendererDestroyed?.();

    expect(onClose).toHaveBeenCalledOnce();
    expect(sender.removeListener).toHaveBeenCalledWith('destroyed', expect.any(Function));
  });
});
