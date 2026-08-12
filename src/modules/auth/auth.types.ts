import { AuthProvider } from './entities/auth-account.entity';

export interface ProviderProfile {
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
}

export interface CurrentUserResponse {
  id: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  avatarUrl: string | null;
  providers: AuthProvider[];
}
