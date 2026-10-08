import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentOptions: Array<{ connect: (...args: never[]) => unknown }> = [];
type Lookup = (
  hostname: string,
  options: { all: boolean },
  callback: (
    error: Error | null,
    address?: string | Array<{ address: string; family: number }>,
    family?: number,
  ) => void,
) => void;

type ConnectorOptions = Record<string, unknown> & {
  host?: unknown;
  lookup?: Lookup;
};

const buildConnectorOptions: ConnectorOptions[] = [];
const connectorCalls: Array<Record<string, unknown>> = [];

vi.mock('undici', () => ({
  Agent: vi.fn((options: { connect: (...args: never[]) => unknown }) => {
    agentOptions.push(options);
    return { close: vi.fn().mockResolvedValue(undefined) };
  }),
  buildConnector: vi.fn((options: ConnectorOptions) => {
    buildConnectorOptions.push(options);
    return vi.fn((connectOptions, callback: (error: null, socket: object) => void) => {
      connectorCalls.push(connectOptions);
      callback(null, {});
    });
  }),
}));

import { createPublicDispatcher } from '../http-target-policy.js';

describe('public dispatcher connector', () => {
  beforeEach(() => {
    agentOptions.length = 0;
    buildConnectorOptions.length = 0;
    connectorCalls.length = 0;
  });

  it('pins the checked address while preserving hostname for TLS/SNI', async () => {
    createPublicDispatcher(async () => [{ address: '8.8.8.8', family: 4 }]);
    const connect = agentOptions[0]?.connect;
    expect(connect).toBeDefined();

    await new Promise<void>((resolve) => {
      connect?.(
        {
          hostname: 'public.example',
          protocol: 'https:',
          port: '443',
          servername: 'public.example',
        },
        () => resolve(),
      );
    });

    const options = buildConnectorOptions[0];
    expect(options).toMatchObject({ port: 443, servername: 'public.example' });
    expect(options.host).toBeUndefined();
    const lookup = options.lookup;
    expect(lookup).toEqual(expect.any(Function));
    expect(lookup).toBeDefined();
    await new Promise<void>((resolve, reject) => {
      lookup?.(
        'public.example',
        { all: true },
        (error: Error | null, address: Array<{ address: string; family: number }>) => {
          if (error) reject(error);
          expect(address).toEqual([{ address: '8.8.8.8', family: 4 }]);
          resolve();
        },
      );
    });
    expect(connectorCalls[0]).toMatchObject({
      host: 'public.example',
      hostname: 'public.example',
      protocol: 'https:',
      servername: 'public.example',
    });
  });

  it('fails the next connection when DNS changes to a private address', async () => {
    let calls = 0;
    createPublicDispatcher(async () => {
      calls += 1;
      return calls === 1
        ? [{ address: '8.8.8.8', family: 4 }]
        : [{ address: '192.168.1.1', family: 4 }];
    });
    await new Promise<void>((resolve) => {
      agentOptions[0]?.connect(
        { hostname: 'public.example', protocol: 'https:', port: '443' },
        () => resolve(),
      );
    });
    const lookup = buildConnectorOptions[0]?.lookup;
    expect(lookup).toBeDefined();
    await new Promise<void>((resolve, reject) => {
      lookup?.('public.example', { all: false }, (error: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await expect(
      new Promise<void>((resolve, reject) => {
        lookup?.('public.example', { all: false }, (error: Error | null) => {
          if (error) reject(error);
          else resolve();
        });
      }),
    ).rejects.toMatchObject({ code: 'HTTP_TARGET_BLOCKED', reason: 'address' });
  });
});
