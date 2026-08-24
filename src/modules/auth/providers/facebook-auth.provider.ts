import {
  BadGatewayException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider } from '../entities/auth-account.entity';
import { ProviderProfile } from '../auth.types';

interface FacebookTokenResponse {
  access_token?: string;
}
interface FacebookProfile {
  id?: string;
  name?: string;
  email?: string;
  picture?: { data?: { url?: string } };
}

@Injectable()
export class FacebookAuthProvider {
  constructor(private readonly config: ConfigService) {}

  getAuthorizationUrl(state: string, challenge: string): string {
    const params = new URLSearchParams({
      client_id: this.required('FACEBOOK_APP_ID'),
      redirect_uri: this.required('FACEBOOK_CALLBACK_URL'),
      response_type: 'code',
      scope: 'public_profile,email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return `https://www.facebook.com/${this.graphVersion}/dialog/oauth?${params}`;
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<ProviderProfile> {
    const params = new URLSearchParams({
      client_id: this.required('FACEBOOK_APP_ID'),
      client_secret: this.required('FACEBOOK_APP_SECRET'),
      redirect_uri: this.required('FACEBOOK_CALLBACK_URL'),
      code,
      code_verifier: codeVerifier,
    });
    const tokenResponse = await fetch(
      `https://graph.facebook.com/${this.graphVersion}/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params,
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!tokenResponse.ok) {
      throw new BadGatewayException('Facebook sign-in could not be completed.');
    }
    const token = (await tokenResponse.json()) as FacebookTokenResponse;
    if (!token.access_token) {
      throw new UnauthorizedException(
        'Facebook did not return a valid identity.',
      );
    }

    const profileParams = new URLSearchParams({
      fields: 'id,name,email,picture.type(large)',
    });
    const profileResponse = await fetch(
      `https://graph.facebook.com/${this.graphVersion}/me?${profileParams}`,
      {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!profileResponse.ok) {
      throw new BadGatewayException('Facebook profile could not be retrieved.');
    }
    const profile = (await profileResponse.json()) as FacebookProfile;
    if (!profile.id) {
      throw new UnauthorizedException('Facebook identity is missing an ID.');
    }
    return {
      provider: AuthProvider.FACEBOOK,
      providerUserId: profile.id,
      email: profile.email ?? null,
      emailVerified: false,
      displayName: profile.name?.trim() || 'Facebook user',
      avatarUrl: profile.picture?.data?.url ?? null,
    };
  }

  private get graphVersion(): string {
    return this.config.get<string>('FACEBOOK_GRAPH_VERSION')?.trim() || 'v23.0';
  }

  private required(name: string): string {
    const value = this.config.get<string>(name)?.trim();
    if (!value) throw new Error(`${name} is not configured.`);
    return value;
  }
}
