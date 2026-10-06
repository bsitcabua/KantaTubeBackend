import { createSocketTicket, verifySocketTicket } from './socket-ticket';

describe('socket tickets', () => {
  const authSessionId = 'auth-session-1';
  const userId = 'user-1';
  const tokenHash = 'a'.repeat(64);
  const now = 1_800_000_000_000;

  it('creates a ticket that can be verified with the session hash', () => {
    const created = createSocketTicket(authSessionId, userId, tokenHash, now);

    expect(verifySocketTicket(created.ticket, tokenHash, now)).toEqual({
      authSessionId,
      userId,
      expiresAt: created.expiresAt.getTime(),
    });
  });

  it('rejects tampered, wrong-session, and expired tickets', () => {
    const created = createSocketTicket(authSessionId, userId, tokenHash, now);
    const [version, payload, signature] = created.ticket.split('.');

    expect(verifySocketTicket(`${version}.${payload}.${'b'.repeat(signature.length)}`, tokenHash, now)).toBeNull();
    expect(verifySocketTicket(created.ticket, 'b'.repeat(64), now)).toBeNull();
    expect(verifySocketTicket(created.ticket, tokenHash, created.expiresAt.getTime())).toBeNull();
  });
});
