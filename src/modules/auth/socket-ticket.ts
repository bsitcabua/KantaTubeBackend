import { createHmac, timingSafeEqual } from 'crypto';

export const SOCKET_TICKET_TTL_MS = 5 * 60 * 1000;

interface SocketTicketClaims {
  version: 1;
  authSessionId: string;
  userId: string;
  expiresAt: number;
}

export interface VerifiedSocketTicket {
  authSessionId: string;
  userId: string;
  expiresAt: number;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string | null {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function signature(payload: string, tokenHash: string): string {
  return createHmac('sha256', tokenHash).update(payload).digest('base64url');
}

export function createSocketTicket(
  authSessionId: string,
  userId: string,
  tokenHash: string,
  now = Date.now(),
): { ticket: string; expiresAt: Date } {
  const expiresAt = now + SOCKET_TICKET_TTL_MS;
  const claims: SocketTicketClaims = {
    version: 1,
    authSessionId,
    userId,
    expiresAt,
  };
  const encodedClaims = encode(JSON.stringify(claims));
  return {
    ticket: `v1.${encodedClaims}.${signature(encodedClaims, tokenHash)}`,
    expiresAt: new Date(expiresAt),
  };
}

export function verifySocketTicket(
  ticket: unknown,
  tokenHash: string,
  now = Date.now(),
): VerifiedSocketTicket | null {
  if (typeof ticket !== 'string') return null;
  const [version, encodedClaims, providedSignature] = ticket.split('.');
  if (
    version !== 'v1' ||
    !encodedClaims ||
    !providedSignature ||
    providedSignature.length !== 43
  ) {
    return null;
  }

  const expectedSignature = signature(encodedClaims, tokenHash);
  const expectedBytes = Buffer.from(expectedSignature, 'utf8');
  const providedBytes = Buffer.from(providedSignature, 'utf8');
  if (
    expectedBytes.length !== providedBytes.length ||
    !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    return null;
  }

  const decoded = decode(encodedClaims);
  if (!decoded) return null;

  try {
    const claims = JSON.parse(decoded) as Partial<SocketTicketClaims>;
    if (
      claims.version !== 1 ||
      typeof claims.authSessionId !== 'string' ||
      typeof claims.userId !== 'string' ||
      !Number.isSafeInteger(claims.expiresAt) ||
      claims.expiresAt <= now
    ) {
      return null;
    }

    return {
      authSessionId: claims.authSessionId,
      userId: claims.userId,
      expiresAt: claims.expiresAt,
    };
  } catch {
    return null;
  }
}
