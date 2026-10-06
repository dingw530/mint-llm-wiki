import { describe, expect, it } from 'vitest';
import {
  HttpTargetBlockedError,
  assertAllowedAddresses,
  isForbiddenAddress,
  resolvePublicAddresses,
} from '../http-target-policy.js';

describe('httpTargetPolicy', () => {
  it.each([
    '0.0.0.1',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.1.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
    '::ffff:192.168.1.1',
  ])('rejects forbidden address %s', (address) => {
    expect(isForbiddenAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888'])('allows public address %s', (address) => {
    expect(isForbiddenAddress(address)).toBe(false);
  });

  it('fails closed when DNS answers mix public and private addresses', () => {
    expect(() =>
      assertAllowedAddresses('example.test', [
        { address: '8.8.8.8', family: 4 },
        { address: '192.168.1.1', family: 4 },
      ]),
    ).toThrowError(HttpTargetBlockedError);
  });

  it('pins a literal address without resolving it', async () => {
    const result = await resolvePublicAddresses('8.8.8.8', async () => {
      throw new Error('resolver must not be called');
    });
    expect(result).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });

  it('fails closed for resolver errors', async () => {
    await expect(
      resolvePublicAddresses('example.test', async () => {
        throw new Error('dns failed');
      }),
    ).rejects.toMatchObject({ code: 'HTTP_TARGET_BLOCKED', reason: 'dns' });
  });
});
