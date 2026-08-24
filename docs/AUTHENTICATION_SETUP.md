# KantaTube Social Authentication Setup

KantaTube uses backend OAuth authorization-code flows with PKCE. Provider tokens are used only during the callback and are not persisted. KantaTube creates an opaque session token, stores only its SHA-256 hash, and sends the raw token in an `HttpOnly` cookie.

## URLs and cookie topology

Local development:

- Frontend: `http://localhost:4200`
- Backend: `http://localhost:4201`
- Google callback: `http://localhost:4201/api/auth/google/callback`
- Facebook callback: `http://localhost:4201/api/auth/facebook/callback`

Production:

- Frontend: `https://kantatube.vercel.app`
- Browser API prefix: `https://kantatube.vercel.app/api`
- Google callback: `https://kantatube.vercel.app/api/auth/google/callback`
- Facebook callback: `https://kantatube.vercel.app/api/auth/facebook/callback`

The frontend's `vercel.json` proxies `/api/*` to Render. This keeps the session cookie first-party and allows `SameSite=Lax`. Do not point the production Angular authentication service directly at the Render hostname unless you intentionally switch to `SameSite=None; Secure` and accept third-party-cookie limitations.

## Backend environment

Copy `.env.example` and configure the database plus:

```dotenv
APP_FRONTEND_URL=http://localhost:4200
APP_FRONTEND_URLS=http://localhost:4200
APP_BACKEND_URL=http://localhost:4201

SESSION_COOKIE_NAME=kantatube_session
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAME_SITE=lax
SESSION_TTL_SECONDS=2592000

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:4201/api/auth/google/callback

FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
FACEBOOK_CALLBACK_URL=http://localhost:4201/api/auth/facebook/callback
FACEBOOK_GRAPH_VERSION=v23.0
```

Production should use:

```dotenv
NODE_ENV=production
APP_FRONTEND_URL=https://kantatube.vercel.app
APP_FRONTEND_URLS=https://kantatube.vercel.app
APP_BACKEND_URL=https://kantatube.vercel.app
SESSION_COOKIE_NAME=__Host-kantatube_session
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAME_SITE=lax
GOOGLE_CALLBACK_URL=https://kantatube.vercel.app/api/auth/google/callback
FACEBOOK_CALLBACK_URL=https://kantatube.vercel.app/api/auth/facebook/callback
```

Never commit real client secrets.

## Database migration

The application keeps TypeORM synchronization disabled. Before deploying the authentication code, apply migrations:

```bash
npm run migration:show
npm run migration:run
```

The migration creates `users`, `auth_accounts`, `auth_sessions`, and `oauth_login_attempts`. Deploy the migration before or together with the application version that registers `AuthModule`.

## Google Cloud Console

1. Configure the OAuth consent screen and application name.
2. Request only `openid`, `email`, and `profile`.
3. Create an OAuth client of type **Web application**.
4. Add the local and production callback URLs above as authorized redirect URIs.
5. Add `http://localhost:4200` and `https://kantatube.vercel.app` as authorized origins if the console requires them.
6. Keep the client secret only in backend environment configuration.

The backend verifies the Google ID-token signature through Google's JWKS and checks issuer, audience, and expiration.

## Meta for Developers

1. Create a Meta app and add **Facebook Login for Web**.
2. Enable Client OAuth Login and Web OAuth Login.
3. Add the local and production Facebook callback URLs above to Valid OAuth Redirect URIs.
4. Set the production App Domain to `kantatube.vercel.app`.
5. Request `public_profile` and `email`. KantaTube supports accounts for which Facebook returns no email.
6. During development, use app administrators, developers, or configured test users.
7. Before Live mode, provide accessible Privacy Policy and User Data Deletion URLs and complete any review required by Meta for the requested permissions.
8. Pin `FACEBOOK_GRAPH_VERSION` to a version supported by the configured Meta app and review it before that version expires.

## Endpoints

- `GET /api/auth/google`
- `GET /api/auth/google/callback`
- `GET /api/auth/facebook`
- `GET /api/auth/facebook/callback`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`

`returnPath` accepts internal application paths only. OAuth attempt state is one-use and expires after ten minutes.

## Guest and remote behavior

The existing random `visitorID` remains guest/room identity and is deliberately separate from account authentication. It can be shared in a remote QR URL, so it must never authorize access to account-owned private data. OAuth preserves safe internal return paths such as `/?remote=<visitorID>`.

Future Favorites and Playlists should have a non-null `userId` foreign key for account-owned records. Guest data can remain local until an explicit authenticated migration endpoint is designed. That endpoint must prove control of the guest identity, deduplicate records, and never accept an arbitrary caller-supplied guest ID as sufficient authorization.

## Known limitations

- Provider credentials and console configuration are required before real OAuth end-to-end testing.
- Account linking is intentionally not implemented. Google and Facebook identities create separate users unless a future authenticated linking flow is added.
- Expired sessions and OAuth attempts are rejected immediately but should also be removed periodically with a maintenance job.
- The existing visitor, search-log, and bug-report listing endpoints are not account-protected; protect or remove them as a separate admin-authorization task.
