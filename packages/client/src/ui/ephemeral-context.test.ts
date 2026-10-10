import { describe, expect, it } from 'vitest';
import { isRemoteEphemeralSender } from './ephemeral-context.js';

describe('isRemoteEphemeralSender', () => {
  it('rejects the host echo of this client while accepting another client', () => {
    expect(isRemoteEphemeralSender(undefined, 'self')).toBe(false);
    expect(isRemoteEphemeralSender('self', 'self')).toBe(false);
    expect(isRemoteEphemeralSender('other', 'self')).toBe(true);
  });
});
