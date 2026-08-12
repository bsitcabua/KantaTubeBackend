import {
  BadGatewayException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, verify } from 'crypto';
import { AuthProvider } from '../entities/auth-account.entity';
import { ProviderProfile } from '../auth.types';

interface GoogleTokenResponse {
  id_token?: string;
}

interface GoogleClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

interface GoogleJwks {
  keys?: Array<JsonWebKey & { kid?: string; alg?: string }>;
}

@Injectable()
export class GoogleAuthProvider {
  constructor(private readonly config: ConfigService) {}

  getAuthorizationUrl(state: string, challenge: string): string {
    const callbackUrl = this.required('GOOGLE_CALLBACK_URL');
    const params = new URLSearchParams({
      client_id: this.required('GOOGLE_CLIENT_ID'),
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<ProviderProfile> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        code,
        client_id: this.required('GOOGLE_CLIENT_ID'),
        client_secret: this.required('GOOGLE_CLIENT_SECRET'),
        redirect_uri: this.required('GOOGLE_CALLBACK_URL'),
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    });
    if (!response.ok) {
      throw new BadGatewayException('Google sign-in could not be completed.');
    }

    const tokens = (await response.json()) as GoogleTokenResponse;
    if (!tokens.id_token) {
      throw new UnauthorizedException(
        'Google did not return a valid identity.',
      );
    }
    const claims = await this.verifyIdToken(tokens.id_token);
    if (!claims.sub) {
      throw new UnauthorizedException('Google identity is missing a subject.');
    }

    return {
      provider: AuthProvider.GOOGLE,
      providerUserId: claims.sub,
      email: claims.email ?? null,
      emailVerified: claims.email_verified === true,
      displayName: claims.name?.trim() || 'Google user',
      avatarUrl: claims.picture ?? null,
    };
  }

  private async verifyIdToken(token: string): Promise<GoogleClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException(
        'Google returned an invalid identity token.',
      );
    }
    const header = this.decodeJson<{ kid?: string; alg?: string }>(parts[0]);
    const claims = this.decodeJson<GoogleClaims>(parts[1]);
    if (!header.kid || header.alg !== 'RS256') {
      throw new UnauthorizedException('Google identity token is not trusted.');
    }

    const jwksResponse = await fetch(
      'https://www.googleapis.com/oauth2/v3/certs',
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!jwksResponse.ok) {
      throw new BadGatewayException(
        'Google identity verification is unavailable.',
      );
    }
    const jwks = (await jwksResponse.json()) as GoogleJwks;
    const jwk = jwks.keys?.find((candidate) => candidate.kid === header.kid);
    if (!jwk) {
      throw new UnauthorizedException(
        'Google identity signing key was not found.',
      );
    }
    const isValid = verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({
        key: jwk as import('crypto').JsonWebKey,
        format: 'jwk',
      }),
      Buffer.from(parts[2], 'base64url'),
    );
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      !isValid ||
      !['https://accounts.google.com', 'accounts.google.com'].includes(
        claims.iss ?? '',
      ) ||
      !audience.includes(this.required('GOOGLE_CLIENT_ID')) ||
      !claims.exp ||
      claims.exp * 1000 <= Date.now()
    ) {
      throw new UnauthorizedException(
        'Google identity token validation failed.',
      );
    }
    return claims;
  }

  private decodeJson<T>(value: string): T {
    try {
      return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
    } catch {
      throw new UnauthorizedException(
        'Google returned malformed identity data.',
      );
    }
  }

  private required(name: string): string {
    const value = this.config.get<string>(name)?.trim();
    if (!value) throw new Error(`${name} is not configured.`);
    return value;
  }
}
