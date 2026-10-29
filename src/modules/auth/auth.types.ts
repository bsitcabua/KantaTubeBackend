import { AuthProvider } from './entities/auth-account.entity';
import { AppearanceMode } from '../users/appearance-mode';

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
  phoneNumber?: string | null;
  addressLine?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  appearanceMode: AppearanceMode;
}

export interface AuthSessionSummaryResponse {
  id: string;
  deviceLabel: string;
  browserLabel: string;
  /** Absolute instants serialized as UTC ISO-8601 strings. */
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}
