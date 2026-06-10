import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import type { DbPool, DbQueryResult, DbTransactionClient } from '../db/client';
import { createHttpApp } from '../http/app';
import { hashToken } from '../services/access-control';
import type { AppleAuthClaims } from '../services/apple-auth-service';
import { registerWithEmail } from '../services/email-auth-service';
import { createUnavailableLiveMarkdownWriter } from '../services/live-writer';

type WorkspaceRole = 'Owner' | 'Member' | 'Reader';

interface LocalUserRecord {
  id: string;
  email: string;
  display_name: string;
  auth_provider: string;
  auth_subject: string;
}

interface LocalSessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

interface LocalOidcStateRecord {
  state_hash: string;
  code_verifier: string;
  native_callback: boolean;
  native_app_state: string | null;
  return_to: string | null;
  provider: string;
  nonce: string | null;
  expires_at: string;
  used_at: string | null;
}

interface LocalEmailCredentialRecord {
  user_id: string;
  password_hash: string;
  email_verified: boolean;
}

interface LocalEmailTokenRecord {
  token_hash: string;
  user_id: string;
  purpose: string;
  expires_at: string;
  used_at: string | null;
}

interface LocalWorkspaceRecord {
  id: string;
  name: string;
  owner_user_id: string;
}

interface LocalWorkspaceMemberRecord {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
}

interface MockOidcState {
  authorizationRequests: number;
  discoveryRequests: number;
  tokenRequests: number;
  userinfoRequests: number;
}

interface IssuedCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  used: boolean;
}

interface MockAccessTokenClaims {
  sub: string;
  email: string;
  email_verified: true;
  name: string;
}

export interface OidcLocalSmokeResult {
  ok: true;
  checks: string[];
  apiBaseUrl: string;
  oidcIssuer: string;
  user: {
    userId: string;
    email: string;
    displayName: string;
  };
  workspace: {
    workspaceId: string;
    name: string;
    role: WorkspaceRole;
  };
  nativeCallbackUrl: string;
  oidcRequests: MockOidcState;
  microsoft: {
    issuer: string;
    userId: string;
    email: string;
    provider: string;
    oidcRequests: MockOidcState;
  };
  email: {
    userId: string;
    email: string;
  };
  apple: {
    userId: string;
    email: string;
    subject: string;
    exchangeCalls: number;
  };
}

const mockClientId = 'marklab-local-smoke';
const mockClientSecret = 'marklab-local-smoke-secret';
const mockUser = {
  sub: 'local-smoke-owner',
  email: 'owner@example.test',
  email_verified: true,
  name: 'Owner Smoke',
} satisfies MockAccessTokenClaims;
const mockMicrosoftUser = {
  sub: 'local-smoke-microsoft',
  email: 'microsoft-owner@example.test',
  email_verified: true,
  name: 'Microsoft Smoke',
} satisfies MockAccessTokenClaims;

function base64UrlSha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location });
  res.end();
}

function badRequest(res: ServerResponse, error: string): void {
  json(res, 400, { error });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function listen(server: Server, port = 0): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server_listen_failed');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('port_reservation_failed');
  const port = (address as AddressInfo).port;
  await close(server);
  return port;
}

function createLocalGate6Pool(): {
  pool: DbPool;
  state: {
    users: LocalUserRecord[];
    workspaces: LocalWorkspaceRecord[];
    emailCredentials: LocalEmailCredentialRecord[];
    oidcStates: LocalOidcStateRecord[];
  };
} {
  const users: LocalUserRecord[] = [];
  const sessions: LocalSessionRecord[] = [];
  const oidcStates: LocalOidcStateRecord[] = [];
  const workspaces: LocalWorkspaceRecord[] = [];
  const members: LocalWorkspaceMemberRecord[] = [];
  const emailCredentials: LocalEmailCredentialRecord[] = [];
  const emailTokens: LocalEmailTokenRecord[] = [];
  let nextUserId = 1;
  let nextSessionId = 1;
  let nextWorkspaceId = 1;

  const query: DbPool['query'] = async <Row = unknown>(sql: string, params?: readonly unknown[]): Promise<DbQueryResult<Row>> => {
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [], rowCount: 0 };

    if (sql.includes('insert into oidc_login_states')) {
      // OIDC: (state_hash, code_verifier, native_callback, native_app_state, return_to, provider, expires_at)
      // Apple: (state_hash, code_verifier, native_callback, native_app_state, return_to, provider, nonce, expires_at)
      const hasNonceColumn = sql.includes('nonce');
      oidcStates.push({
        state_hash: String(params?.[0]),
        code_verifier: String(params?.[1]),
        native_callback: params?.[2] === true,
        native_app_state: typeof params?.[3] === 'string' ? params[3] : null,
        return_to: typeof params?.[4] === 'string' ? params[4] : null,
        provider: typeof params?.[5] === 'string' ? params[5] : 'google',
        nonce: hasNonceColumn && typeof params?.[6] === 'string' ? params[6] : null,
        expires_at: '2999-01-01T00:00:00.000Z',
        used_at: null,
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('update oidc_login_states')) {
      // Apple scopes the update by provider; the OIDC route does not.
      const providerFilter = sql.includes('and provider = $2') ? params?.[1] : undefined;
      const state = oidcStates.find(
        (candidate) =>
          candidate.state_hash === params?.[0]
          && !candidate.used_at
          && (providerFilter === undefined || candidate.provider === providerFilter),
      );
      if (!state) return { rows: [], rowCount: 0 };
      state.used_at = '2026-05-22T00:00:00.000Z';
      return { rows: [{
        code_verifier: state.code_verifier,
        native_callback: state.native_callback,
        native_app_state: state.native_app_state,
        return_to: state.return_to,
        provider: state.provider,
      } as Row], rowCount: 1 };
    }

    if (sql.includes('insert into users')) {
      const provider = String(params?.[2]);
      const subject = String(params?.[3]);
      let user = users.find((candidate) => candidate.auth_provider === provider && candidate.auth_subject === subject);
      if (!user) {
        if (users.some((candidate) => candidate.email === params?.[0])) {
          const error = new Error('duplicate email') as Error & { code: string; constraint: string };
          error.code = '23505';
          error.constraint = 'users_email_key';
          throw error;
        }
        user = {
          id: `user_${nextUserId++}`,
          email: String(params?.[0]),
          display_name: String(params?.[1]),
          auth_provider: provider,
          auth_subject: subject,
        };
        users.push(user);
      } else {
        user.email = String(params?.[0]);
        user.display_name = String(params?.[1]);
      }
      return { rows: [{ id: user.id, email: user.email, display_name: user.display_name } as Row], rowCount: 1 };
    }

    if (sql.includes('update users') && sql.includes("auth_provider = 'manual-alpha'")) {
      const user = users.find((candidate) => candidate.email === params?.[0] && candidate.auth_provider === 'manual-alpha');
      if (!user) return { rows: [], rowCount: 0 };
      user.display_name = String(params?.[1]);
      user.auth_provider = String(params?.[2]);
      user.auth_subject = String(params?.[3]);
      return { rows: [{ id: user.id, email: user.email, display_name: user.display_name } as Row], rowCount: 1 };
    }

    if (sql.includes('insert into user_sessions')) {
      const row: LocalSessionRecord = {
        id: `usr_session_${nextSessionId++}`,
        user_id: String(params?.[0]),
        token_hash: String(params?.[1]),
        expires_at: '2999-01-01T00:00:00.000Z',
        revoked_at: null,
      };
      sessions.push(row);
      return { rows: [{ id: row.id, expires_at: row.expires_at } as Row], rowCount: 1 };
    }

    if (sql.includes('update user_sessions') && sql.includes('from users')) {
      const session = sessions.find((candidate) => candidate.token_hash === params?.[0] && !candidate.revoked_at);
      const user = session ? users.find((candidate) => candidate.id === session.user_id) : undefined;
      if (!session || !user) return { rows: [], rowCount: 0 };
      return {
        rows: [{ session_id: session.id, id: user.id, email: user.email, display_name: user.display_name } as Row],
        rowCount: 1,
      };
    }

    // Revoke-all-for-user (password reset eviction): revoke every active session.
    if (sql.includes('update user_sessions') && sql.includes('where user_id = $1')) {
      let revoked = 0;
      for (const session of sessions) {
        if (session.user_id === params?.[0] && !session.revoked_at) {
          session.revoked_at = '2026-05-22T00:00:00.000Z';
          revoked += 1;
        }
      }
      return { rows: [], rowCount: revoked };
    }

    if (sql.includes('insert into workspaces')) {
      const row: LocalWorkspaceRecord = {
        id: `ws_${nextWorkspaceId++}`,
        name: String(params?.[0]),
        owner_user_id: String(params?.[1]),
      };
      workspaces.push(row);
      return { rows: [{ id: row.id, name: row.name, role: 'Owner' } as Row], rowCount: 1 };
    }

    if (sql.includes('insert into workspace_members') && sql.includes("values ($1, $2, 'Owner')")) {
      const existing = members.find((member) => member.workspace_id === params?.[0] && member.user_id === params?.[1]);
      if (existing) {
        existing.role = 'Owner';
      } else {
        members.push({ workspace_id: String(params?.[0]), user_id: String(params?.[1]), role: 'Owner' });
      }
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('insert into subscriptions')) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('from workspace_members m') && sql.includes('join workspaces w') && sql.includes('where m.user_id = $1')) {
      const rows = members
        .filter((member) => member.user_id === params?.[0])
        .map((member) => {
          const workspace = workspaces.find((candidate) => candidate.id === member.workspace_id);
          if (!workspace) throw new Error(`missing_workspace:${member.workspace_id}`);
          return { id: workspace.id, name: workspace.name, role: member.role };
        })
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
      return { rows: rows as Row[], rowCount: rows.length };
    }

    // --- Apple: repeat-login email lookup by (provider, subject). ---
    if (sql.includes('select email from users') && sql.includes('where auth_provider = $1 and auth_subject = $2')) {
      const user = users.find((candidate) => candidate.auth_provider === params?.[0] && candidate.auth_subject === params?.[1]);
      return { rows: user ? [{ email: user.email } as Row] : [], rowCount: user ? 1 : 0 };
    }

    // --- Email register: find-or-create the shared users row by (provider, subject). ---
    if (sql.includes('select id, email, display_name') && sql.includes('from users') && sql.includes('where auth_provider = $1 and auth_subject = $2')) {
      const user = users.find((candidate) => candidate.auth_provider === params?.[0] && candidate.auth_subject === params?.[1]);
      return {
        rows: user ? [{ id: user.id, email: user.email, display_name: user.display_name } as Row] : [],
        rowCount: user ? 1 : 0,
      };
    }

    // --- Email credentials lookups / writes. ---
    if (sql.includes('select user_id from email_auth_credentials')) {
      const credential = emailCredentials.find((candidate) => candidate.user_id === params?.[0]);
      return { rows: credential ? [{ user_id: credential.user_id } as Row] : [], rowCount: credential ? 1 : 0 };
    }

    if (sql.includes('insert into email_auth_credentials')) {
      const userId = String(params?.[0]);
      // Mirror `on conflict (user_id) do nothing returning user_id`: only insert
      // (and return a row) when no credential exists for the user yet.
      const existing = emailCredentials.find((candidate) => candidate.user_id === userId);
      if (existing) return { rows: [], rowCount: 0 };
      emailCredentials.push({
        user_id: userId,
        password_hash: String(params?.[1]),
        email_verified: false,
      });
      return { rows: [{ user_id: userId } as Row], rowCount: 1 };
    }

    if (sql.includes('update email_auth_credentials') && sql.includes('email_verified = true')) {
      const credential = emailCredentials.find((candidate) => candidate.user_id === params?.[0]);
      if (credential) credential.email_verified = true;
      return { rows: [], rowCount: credential ? 1 : 0 };
    }

    if (sql.includes('update email_auth_credentials') && sql.includes('set password_hash = $1')) {
      const credential = emailCredentials.find((candidate) => candidate.user_id === params?.[1]);
      if (credential) credential.password_hash = String(params?.[0]);
      return { rows: [], rowCount: credential ? 1 : 0 };
    }

    // --- Email login: join credentials + users by (provider, subject). ---
    if (sql.includes('from email_auth_credentials eac') && sql.includes('join users u')) {
      const user = users.find((candidate) => candidate.auth_provider === params?.[0] && candidate.auth_subject === params?.[1]);
      const credential = user ? emailCredentials.find((candidate) => candidate.user_id === user.id) : undefined;
      if (!user || !credential) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          user_id: credential.user_id,
          password_hash: credential.password_hash,
          email_verified: credential.email_verified,
          email: user.email,
          display_name: user.display_name,
        } as Row],
        rowCount: 1,
      };
    }

    // --- Email verification / reset tokens. ---
    if (sql.includes('insert into email_verification_tokens')) {
      emailTokens.push({
        token_hash: String(params?.[0]),
        user_id: String(params?.[1]),
        purpose: String(params?.[2]),
        expires_at: '2999-01-01T00:00:00.000Z',
        used_at: null,
      });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes('update email_verification_tokens') && sql.includes('set used_at = now()')) {
      const purpose = sql.includes("purpose = 'verify_email'") ? 'verify_email' : 'reset_password';
      const token = emailTokens.find((candidate) => candidate.token_hash === params?.[0] && candidate.purpose === purpose && !candidate.used_at);
      if (!token) return { rows: [], rowCount: 0 };
      token.used_at = '2026-05-22T00:00:00.000Z';
      return { rows: [{ user_id: token.user_id } as Row], rowCount: 1 };
    }

    throw new Error(`unexpected_query:${sql}`);
  };

  const pool: DbPool = {
    query,
    async connect(): Promise<DbTransactionClient> {
      return { query, release: () => undefined };
    },
  };

  return { pool, state: { users, workspaces, emailCredentials, oidcStates } };
}

async function startMockOidcProvider(
  user: MockAccessTokenClaims = mockUser,
): Promise<{ issuer: string; requests: MockOidcState; close: () => Promise<void> }> {
  const requests: MockOidcState = {
    authorizationRequests: 0,
    discoveryRequests: 0,
    tokenRequests: 0,
    userinfoRequests: 0,
  };
  const codes = new Map<string, IssuedCode>();
  const accessTokens = new Map<string, MockAccessTokenClaims>();
  let issuer = '';
  let nextCode = 1;
  let nextAccessToken = 1;

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? '/', issuer);
      if (req.method === 'GET' && requestUrl.pathname === '/.well-known/openid-configuration') {
        requests.discoveryRequests += 1;
        json(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
        });
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/authorize') {
        requests.authorizationRequests += 1;
        const redirectUri = requestUrl.searchParams.get('redirect_uri') ?? '';
        const state = requestUrl.searchParams.get('state') ?? '';
        const codeChallenge = requestUrl.searchParams.get('code_challenge') ?? '';
        if (requestUrl.searchParams.get('response_type') !== 'code') return badRequest(res, 'invalid_response_type');
        if (requestUrl.searchParams.get('client_id') !== mockClientId) return badRequest(res, 'invalid_client_id');
        if (!redirectUri || !state || !codeChallenge) return badRequest(res, 'missing_authorize_param');
        if (requestUrl.searchParams.get('code_challenge_method') !== 'S256') return badRequest(res, 'invalid_pkce_method');
        const code = `mock_code_${nextCode++}`;
        codes.set(code, {
          clientId: mockClientId,
          redirectUri,
          codeChallenge,
          used: false,
        });
        const callbackUrl = new URL(redirectUri);
        callbackUrl.searchParams.set('code', code);
        callbackUrl.searchParams.set('state', state);
        redirect(res, callbackUrl.toString());
        return;
      }

      if (req.method === 'POST' && requestUrl.pathname === '/token') {
        requests.tokenRequests += 1;
        const form = new URLSearchParams(await readBody(req));
        const code = form.get('code') ?? '';
        const issued = codes.get(code);
        if (form.get('grant_type') !== 'authorization_code') return badRequest(res, 'invalid_grant_type');
        if (!issued || issued.used) return badRequest(res, 'invalid_code');
        if (form.get('client_id') !== issued.clientId) return badRequest(res, 'invalid_client_id');
        if (form.get('client_secret') !== mockClientSecret) return badRequest(res, 'invalid_client_secret');
        if (form.get('redirect_uri') !== issued.redirectUri) return badRequest(res, 'invalid_redirect_uri');
        const verifier = form.get('code_verifier') ?? '';
        if (base64UrlSha256(verifier) !== issued.codeChallenge) return badRequest(res, 'invalid_pkce_verifier');
        issued.used = true;
        const accessToken = `mock_access_${nextAccessToken++}`;
        accessTokens.set(accessToken, user);
        json(res, 200, { access_token: accessToken, token_type: 'Bearer' });
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === '/userinfo') {
        requests.userinfoRequests += 1;
        const accessToken = /^Bearer\s+(.+)$/iu.exec(req.headers.authorization ?? '')?.[1] ?? '';
        const claims = accessTokens.get(accessToken);
        if (!claims) return json(res, 401, { error: 'invalid_token' });
        json(res, 200, claims);
        return;
      }

      json(res, 404, { error: 'not_found' });
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : 'mock_oidc_failed' });
    }
  });

  issuer = await listen(server);
  return {
    issuer,
    requests,
    close: () => close(server),
  };
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<{ response: Response; body: T }> {
  const response = await fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      ...init?.headers,
    },
  });
  const body = await response.json() as T;
  return { response, body };
}

function cookieHeader(response: Response, cookieName: string): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`missing_cookie:${cookieName}`);
  const match = new RegExp(`${cookieName}=[^;]+`, 'u').exec(setCookie);
  if (!match) throw new Error(`missing_cookie:${cookieName}`);
  return match[0];
}

function requireOk(response: Response, label: string): void {
  if (!response.ok) throw new Error(`${label}_failed:${response.status}`);
}

/**
 * Drives one Apple Sign In web (form_post) round trip against the local app.
 * The authorization redirect points at the real appleid.apple.com endpoint, so
 * it is NEVER followed — we read the state from the Set-Cookie header and POST
 * the form_post callback directly. The injected fake exchange stands in for the
 * Apple token endpoint + JWKS, so no network call is made.
 */
async function runAppleCallback(input: { apiBaseUrl: string }): Promise<{
  user: { userId: string; email: string; displayName: string };
  token: string;
}> {
  const startResponse = await fetch(`${input.apiBaseUrl}/api/auth/apple/start`, { redirect: 'manual' });
  if (startResponse.status !== 302) throw new Error(`apple_start_redirect_failed:${startResponse.status}`);
  const location = startResponse.headers.get('location');
  if (!location || !location.startsWith('https://appleid.apple.com/auth/authorize')) {
    throw new Error('apple_start_did_not_target_apple_authorize');
  }
  const stateCookie = cookieHeader(startResponse, 'marklab_apple_state');
  const state = decodeURIComponent(stateCookie.split('=')[1] ?? '');
  if (!state) throw new Error('missing_apple_state_cookie');

  const callbackResponse = await fetch(`${input.apiBaseUrl}/api/auth/apple/callback`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: stateCookie },
    body: new URLSearchParams({ code: 'apple_mock_code', state }).toString(),
  });
  // Web (non-native) callback 303-redirects back to the web app and sets the
  // session cookie; the minted user identity is recovered from that cookie.
  if (callbackResponse.status !== 303) throw new Error(`apple_callback_redirect_failed:${callbackResponse.status}`);
  const sessionCookieHeader = cookieHeader(callbackResponse, 'marklab_session');
  const token = decodeURIComponent(sessionCookieHeader.split('=')[1] ?? '');
  if (!token) throw new Error('missing_apple_session_cookie');

  const session = await fetchJson<{ authenticated: boolean; user: { userId: string; email: string; displayName: string } }>(
    `${input.apiBaseUrl}/api/auth/session`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  requireOk(session.response, 'apple_session_read');
  if (!session.body.authenticated) throw new Error('apple_session_not_authenticated');
  return { user: session.body.user, token };
}

function redactedNativeCallbackUrl(input: {
  rawToken: string;
  appState: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  userId: string;
  email: string;
  displayName: string;
}): string {
  const callbackUrl = new URL('marklab://auth/callback');
  callbackUrl.searchParams.set('token', 'REDACTED');
  callbackUrl.searchParams.set('apiBaseURL', input.apiBaseUrl);
  callbackUrl.searchParams.set('webBaseURL', input.webBaseUrl);
  callbackUrl.searchParams.set('userId', input.userId);
  callbackUrl.searchParams.set('email', input.email);
  callbackUrl.searchParams.set('displayName', input.displayName);
  callbackUrl.searchParams.set('appState', input.appState);
  if (!input.rawToken.startsWith('ml_user_')) throw new Error('unexpected_user_token_shape');
  return callbackUrl.toString();
}

// Apple Sign In subject used by the injected fake exchange. Apple only returns
// the email on the FIRST login for a subject; on repeat logins the route must
// recover it from the stored users row (lookup by auth_subject).
const appleSubject = 'apple-sub-local-smoke';
const appleEmail = 'apple-owner@example.test';
const appleName = 'Apple Smoke';

export async function runLocalOidcSmoke(): Promise<OidcLocalSmokeResult> {
  const checks: string[] = [];
  const oidc = await startMockOidcProvider();
  const microsoftOidc = await startMockOidcProvider(mockMicrosoftUser);
  const apiPort = await reservePort();
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const webBaseUrl = 'http://127.0.0.1:5173';
  const redirectUri = `${apiBaseUrl}/auth/callback`;
  const { pool, state: poolState } = createLocalGate6Pool();

  // Fake Apple exchange: real network/JWKS verification is replaced. Emits the
  // email only on the first call so the repeat-login email-by-subject lookup is
  // exercised. `firstName`/`lastName` are honored exactly like the real path.
  // Boxed in an object so the counter survives mutation across the
  // `runAppleCallback` function boundary. Read via `appleExchangeCalls()` so TS
  // does not literal-narrow it after an equality guard.
  const appleExchangeState = { calls: 0 };
  const appleExchangeCalls = (): number => appleExchangeState.calls;
  const appleExchange = async (input: {
    code: string;
    codeVerifier: string;
    config: { clientId: string };
    userName?: { firstName?: string | null; lastName?: string | null };
  }): Promise<AppleAuthClaims> => {
    appleExchangeState.calls += 1;
    const isFirstLogin = appleExchangeState.calls === 1;
    if (!input.code || !input.codeVerifier) throw new Error('apple_token_exchange_failed');
    return {
      subject: appleSubject,
      emailVerified: true,
      ...(isFirstLogin ? { email: appleEmail } : {}),
      ...(isFirstLogin ? { name: appleName } : {}),
    };
  };

  const app = createHttpApp(pool, createUnavailableLiveMarkdownWriter(), {
    authEnvironment: {
      devAuth: false,
      nodeEnv: 'test',
      oidc: {
        issuer: oidc.issuer,
        clientId: mockClientId,
        clientSecret: mockClientSecret,
        redirectUri,
      },
    },
    authProviders: {
      // Microsoft OIDC against a second loopback mock provider. The loopback
      // mock issuer genuinely differs from the configured issuer, so disable the
      // discovery issuer-match check. Email verification is enforced (the mock
      // returns email_verified:true). Note: production pins a concrete tenant and
      // validates the id_token `tid` via idTokenValidation; this smoke exercises
      // the userinfo path and does not mock a signed id_token / JWKS.
      oidcProviders: {
        microsoft: {
          issuer: microsoftOidc.issuer,
          clientId: mockClientId,
          clientSecret: mockClientSecret,
          redirectUri,
          requireDiscoveryIssuerMatch: false,
        },
      },
      // Apple config is structurally valid but never used to hit Apple — the
      // injected `appleExchange` replaces the network token exchange + JWKS.
      apple: {
        clientId: 'com.example.marklab.smoke',
        teamId: 'TEAMID1234',
        keyId: 'KEYID12345',
        privateKey: 'unused-by-fake-exchange',
        redirectUri: `${apiBaseUrl}/api/auth/apple/callback`,
      },
      appleExchange,
      appleBaseUrls: { apiBaseUrl, webBaseUrl },
      // Email routes mount only when this is present. The values are never used
      // to send mail in this smoke: registration is driven through the service
      // directly (no Resend network call) and verification is simulated.
      email: {
        resendApiKey: 're_local_smoke_unused',
        emailFrom: 'MarkLab Smoke <noreply@example.test>',
        apiBaseUrl,
        webBaseUrl,
      },
    },
  });
  const apiServer = createServer(app);

  try {
    await listen(apiServer, apiPort);

    const start = await fetchJson<{ authorizationUrl: string }>(`${apiBaseUrl}/api/auth/oidc/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ native: true, appState: 'native_state_native_state_native_state_1' }),
    });
    requireOk(start.response, 'oidc_start');
    const state = new URL(start.body.authorizationUrl).searchParams.get('state');
    if (!state) throw new Error('missing_oidc_state');
    const oidcCookie = cookieHeader(start.response, 'marklab_oidc_state');
    checks.push('oidc_start_sets_state_cookie_and_authorization_url');

    const authorizeResponse = await fetch(start.body.authorizationUrl, { redirect: 'manual' });
    if (authorizeResponse.status !== 302) throw new Error(`authorize_redirect_failed:${authorizeResponse.status}`);
    const callbackLocation = authorizeResponse.headers.get('location');
    if (!callbackLocation) throw new Error('missing_authorize_location');
    const callbackUrl = new URL(callbackLocation);
    const code = callbackUrl.searchParams.get('code');
    const returnedState = callbackUrl.searchParams.get('state');
    if (!code || returnedState !== state) throw new Error('invalid_authorize_callback');
    checks.push('mock_oidc_authorize_redirects_with_code_and_state');

    const callback = await fetchJson<{
      user: { userId: string; email: string; displayName: string };
      token: string;
      nativeCallback: boolean;
      nativeAppState?: string;
    }>(`${apiBaseUrl}/api/auth/oidc/callback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: oidcCookie,
      },
      body: JSON.stringify({ code, state }),
    });
    requireOk(callback.response, 'oidc_callback');
    if (!callback.body.token.startsWith('ml_user_')) throw new Error('missing_user_session_token');
    if (callback.body.nativeCallback !== true) throw new Error('missing_native_callback_intent');
    if (callback.body.nativeAppState !== 'native_state_native_state_native_state_1') throw new Error('missing_native_app_state');
    if (callback.body.user.email !== mockUser.email || callback.body.user.displayName !== mockUser.name) {
      throw new Error('unexpected_user_identity');
    }
    checks.push('oidc_callback_exchanges_code_and_creates_owner_session');

    const bearer = { Authorization: `Bearer ${callback.body.token}` };
    const session = await fetchJson<{ authenticated: boolean; user: { userId: string; email: string; displayName: string } }>(
      `${apiBaseUrl}/api/auth/session`,
      { headers: bearer },
    );
    requireOk(session.response, 'session_read');
    if (!session.body.authenticated || session.body.user.userId !== callback.body.user.userId) throw new Error('session_read_mismatch');
    checks.push('bearer_session_authenticates_api_requests');

    const emptyList = await fetchJson<{ workspaces: unknown[] }>(`${apiBaseUrl}/api/workspaces`, { headers: bearer });
    requireOk(emptyList.response, 'workspace_empty_list');
    if (emptyList.body.workspaces.length !== 0) throw new Error('workspace_list_not_empty');
    checks.push('owner_can_list_empty_workspaces');

    const created = await fetchJson<{ workspace: { workspaceId: string; name: string; role: WorkspaceRole } }>(
      `${apiBaseUrl}/api/workspaces`,
      {
        method: 'POST',
        headers: {
          ...bearer,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Gate 6 Smoke Workspace' }),
      },
    );
    requireOk(created.response, 'workspace_create');
    if (created.body.workspace.role !== 'Owner') throw new Error('workspace_owner_role_missing');
    checks.push('owner_can_create_self_serve_workspace');

    const listed = await fetchJson<{ workspaces: Array<{ workspaceId: string; name: string; role: WorkspaceRole }> }>(
      `${apiBaseUrl}/api/workspaces`,
      { headers: bearer },
    );
    requireOk(listed.response, 'workspace_list_after_create');
    if (listed.body.workspaces[0]?.workspaceId !== created.body.workspace.workspaceId) throw new Error('created_workspace_not_listed');
    checks.push('created_workspace_is_listed_for_owner');

    if (oidc.requests.discoveryRequests < 2 || oidc.requests.authorizationRequests !== 1 || oidc.requests.tokenRequests !== 1 || oidc.requests.userinfoRequests !== 1) {
      throw new Error('unexpected_oidc_request_counts');
    }
    checks.push('oidc_discovery_token_and_userinfo_endpoints_were_exercised');

    // ---------------------------------------------------------------------
    // Microsoft OIDC (provider=microsoft) against a second loopback provider.
    // ---------------------------------------------------------------------
    const msStart = await fetchJson<{ authorizationUrl: string }>(`${apiBaseUrl}/api/auth/oidc/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'microsoft' }),
    });
    requireOk(msStart.response, 'microsoft_oidc_start');
    const msAuthUrl = new URL(msStart.body.authorizationUrl);
    if (!msAuthUrl.toString().startsWith(microsoftOidc.issuer)) throw new Error('microsoft_authorization_url_wrong_issuer');
    const msState = msAuthUrl.searchParams.get('state');
    if (!msState) throw new Error('missing_microsoft_oidc_state');
    const msCookie = cookieHeader(msStart.response, 'marklab_oidc_state');
    // The login-state row must carry provider=microsoft (else the callback would
    // resolve the Google config and exchange against the wrong issuer).
    const msStateRow = poolState.oidcStates.find((candidate) => candidate.state_hash === hashToken(msState));
    if (!msStateRow || msStateRow.provider !== 'microsoft') throw new Error('microsoft_provider_not_persisted_in_login_state');
    checks.push('microsoft_oidc_start_persists_provider_and_targets_microsoft_issuer');

    const msAuthorize = await fetch(msStart.body.authorizationUrl, { redirect: 'manual' });
    if (msAuthorize.status !== 302) throw new Error(`microsoft_authorize_redirect_failed:${msAuthorize.status}`);
    const msCallbackLocation = msAuthorize.headers.get('location');
    if (!msCallbackLocation) throw new Error('missing_microsoft_authorize_location');
    const msCode = new URL(msCallbackLocation).searchParams.get('code');
    if (!msCode) throw new Error('missing_microsoft_authorize_code');

    const msCallback = await fetchJson<{ user: { userId: string; email: string; displayName: string }; token: string }>(
      `${apiBaseUrl}/api/auth/oidc/callback`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: msCookie },
        body: JSON.stringify({ code: msCode, state: msState }),
      },
    );
    requireOk(msCallback.response, 'microsoft_oidc_callback');
    if (!msCallback.body.token.startsWith('ml_user_')) throw new Error('missing_microsoft_user_session_token');
    if (msCallback.body.user.email !== mockMicrosoftUser.email) throw new Error('unexpected_microsoft_identity');
    if (msStateRow.used_at === null) throw new Error('microsoft_login_state_not_consumed');
    // The minted Microsoft user must be distinct from the Google user above.
    if (msCallback.body.user.userId === callback.body.user.userId) throw new Error('microsoft_user_collided_with_google');
    const msSession = await fetchJson<{ authenticated: boolean; user: { userId: string } }>(
      `${apiBaseUrl}/api/auth/session`,
      { headers: { Authorization: `Bearer ${msCallback.body.token}` } },
    );
    requireOk(msSession.response, 'microsoft_session_read');
    if (!msSession.body.authenticated || msSession.body.user.userId !== msCallback.body.user.userId) throw new Error('microsoft_session_mismatch');
    if (microsoftOidc.requests.tokenRequests !== 1 || microsoftOidc.requests.userinfoRequests !== 1) throw new Error('unexpected_microsoft_request_counts');
    checks.push('microsoft_oidc_callback_mints_ml_user_session_via_provider_routed_exchange');

    // ---------------------------------------------------------------------
    // Email register -> simulate verify -> login (+ negative cases).
    // Registration is exercised through the real service against the in-memory
    // pool (no Resend network); verification is simulated by flipping the
    // email_verified flag; login/negative paths go through the HTTP routes.
    // ---------------------------------------------------------------------
    const emailAddress = 'email-user@example.test';
    const emailPassword = 'correct-horse-battery-staple';
    const { userId: emailUserId } = await registerWithEmail(pool, {
      email: emailAddress,
      password: emailPassword,
      displayName: 'Email Smoke',
    });
    const emailCredential = poolState.emailCredentials.find((candidate) => candidate.user_id === emailUserId);
    if (!emailCredential) throw new Error('email_credential_not_created');
    if (emailCredential.email_verified !== false) throw new Error('email_unexpectedly_pre_verified');
    checks.push('email_register_creates_unverified_credential');

    // Login before verification must be rejected.
    const unverifiedLogin = await fetchJson<{ error?: string }>(`${apiBaseUrl}/api/auth/email/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailAddress, password: emailPassword }),
    });
    if (unverifiedLogin.response.status !== 403 || unverifiedLogin.body.error !== 'email_not_verified') {
      throw new Error(`email_login_before_verify_not_rejected:${unverifiedLogin.response.status}`);
    }
    checks.push('email_login_rejected_until_verified');

    // Simulate the verification step by flipping email_verified.
    emailCredential.email_verified = true;

    const verifiedLogin = await fetchJson<{ user: { userId: string; email: string }; token: string }>(
      `${apiBaseUrl}/api/auth/email/login`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: emailAddress, password: emailPassword }),
      },
    );
    requireOk(verifiedLogin.response, 'email_login');
    if (!verifiedLogin.body.token.startsWith('ml_user_')) throw new Error('missing_email_user_session_token');
    if (verifiedLogin.body.user.userId !== emailUserId) throw new Error('email_login_user_mismatch');
    const emailSession = await fetchJson<{ authenticated: boolean; user: { userId: string } }>(
      `${apiBaseUrl}/api/auth/session`,
      { headers: { Authorization: `Bearer ${verifiedLogin.body.token}` } },
    );
    requireOk(emailSession.response, 'email_session_read');
    if (!emailSession.body.authenticated || emailSession.body.user.userId !== emailUserId) throw new Error('email_session_mismatch');
    checks.push('email_login_after_verify_mints_ml_user_session');

    // Wrong password is rejected with the generic invalid_email_or_password.
    const wrongPassword = await fetchJson<{ error?: string }>(`${apiBaseUrl}/api/auth/email/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailAddress, password: 'totally-wrong-password' }),
    });
    if (wrongPassword.response.status !== 401 || wrongPassword.body.error !== 'invalid_email_or_password') {
      throw new Error(`email_wrong_password_not_rejected:${wrongPassword.response.status}`);
    }
    checks.push('email_login_rejects_wrong_password');

    // Unknown email is enumeration-safe: same status + error as wrong password.
    const unknownEmail = await fetchJson<{ error?: string }>(`${apiBaseUrl}/api/auth/email/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody-unknown@example.test', password: emailPassword }),
    });
    if (unknownEmail.response.status !== wrongPassword.response.status || unknownEmail.body.error !== wrongPassword.body.error) {
      throw new Error(`email_unknown_address_not_enumeration_safe:${unknownEmail.response.status}:${unknownEmail.body.error}`);
    }
    checks.push('email_login_unknown_address_is_enumeration_safe');

    // ---------------------------------------------------------------------
    // Apple callback (form_post) with the injected fake exchange.
    // ---------------------------------------------------------------------
    const appleFirst = await runAppleCallback({ apiBaseUrl });
    if (!appleFirst.token.startsWith('ml_user_')) throw new Error('missing_apple_user_session_token');
    if (appleFirst.user.email !== appleEmail) throw new Error('unexpected_apple_first_login_email');
    if (appleExchangeCalls() !== 1) throw new Error('apple_exchange_not_invoked_once');
    const appleUserId = appleFirst.user.userId;
    checks.push('apple_first_login_mints_ml_user_session_and_stores_email');

    // Repeat login: the fake omits the email, so the route must recover it from
    // the stored users row via the (provider, subject) lookup and reuse the user.
    const appleRepeat = await runAppleCallback({ apiBaseUrl });
    if (!appleRepeat.token.startsWith('ml_user_')) throw new Error('missing_apple_repeat_session_token');
    if (appleRepeat.user.email !== appleEmail) throw new Error('apple_repeat_login_email_lookup_failed');
    if (appleRepeat.user.userId !== appleUserId) throw new Error('apple_repeat_login_user_collision');
    if (appleExchangeCalls() !== 2) throw new Error('apple_exchange_not_invoked_twice');
    const appleUsers = poolState.users.filter((candidate) => candidate.auth_provider === 'apple' && candidate.auth_subject === appleSubject);
    if (appleUsers.length !== 1) throw new Error('apple_repeat_login_created_duplicate_user');
    checks.push('apple_repeat_login_recovers_email_by_subject_and_reuses_user');

    return {
      ok: true,
      checks,
      apiBaseUrl,
      oidcIssuer: oidc.issuer,
      user: callback.body.user,
      workspace: created.body.workspace,
      nativeCallbackUrl: redactedNativeCallbackUrl({
        rawToken: callback.body.token,
        appState: callback.body.nativeAppState,
        apiBaseUrl,
        webBaseUrl,
        userId: callback.body.user.userId,
        email: callback.body.user.email,
        displayName: callback.body.user.displayName,
      }),
      oidcRequests: { ...oidc.requests },
      microsoft: {
        issuer: microsoftOidc.issuer,
        userId: msCallback.body.user.userId,
        email: msCallback.body.user.email,
        provider: msStateRow.provider,
        oidcRequests: { ...microsoftOidc.requests },
      },
      email: {
        userId: emailUserId,
        email: emailAddress,
      },
      apple: {
        userId: appleUserId,
        email: appleFirst.user.email,
        subject: appleSubject,
        exchangeCalls: appleExchangeCalls(),
      },
    };
  } finally {
    await close(apiServer);
    await oidc.close();
    await microsoftOidc.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalOidcSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
