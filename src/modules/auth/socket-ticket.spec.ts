import { createSocketTicket, verifySocketTicket } from './socket-ticket';

describe('socket tickets', () => {
  const authSessionId = 'auth-session-1';
  const userId = 'user-1';
  const tokenHash = 'a'.repeat(64);
  const now = 1_800_000_000_000;

  it('creates a ticket that can be verified with the session hash', () => {
    const created = createSocketTicket(authSessionId, userId, tokenHash, undefined, now);

    expect(verifySocketTicket(created.ticket, tokenHash, now)).toEqual({
      authSessionId,
      userId,
      expiresAt: created.expiresAt.getTime(),
    });
  });

  it('rejects tampered, wrong-session, and expired tickets', () => {
    const created = createSocketTicket(authSessionId, userId, tokenHash, undefined, now);
    const [version, payload, signature] = created.ticket.split('.');

    expect(verifySocketTicket(`${version}.${payload}.${'b'.repeat(signature.length)}`, tokenHash, now)).toBeNull();
    expect(verifySocketTicket(created.ticket, 'b'.repeat(64), now)).toBeNull();
    expect(verifySocketTicket(created.ticket, tokenHash, created.expiresAt.getTime())).toBeNull();
  });

  it('binds a ticket to a karaoke session without exposing the session in its signature', () => {
    const karaokeSessionId = '123e4567-e89b-42d3-a456-426614174000';
    const created = createSocketTicket(
      authSessionId,
      userId,
      tokenHash,
      karaokeSessionId,
      now,
    );

    expect(verifySocketTicket(created.ticket, tokenHash, now)).toEqual({
      authSessionId,
      userId,
      karaokeSessionId,
      expiresAt: created.expiresAt.getTime(),
    });
  });
});
