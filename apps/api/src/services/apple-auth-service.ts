import { createHash } from 'node:crypto';
import { SignJWT, importPKCS8, jwtVerify, createRemoteJWKSet } from 'jose';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppleAuthConfig {
  /** Apple Service ID used as the web client_id (e.g. com.example.app). */
  clientId: string;
  /** 10-character Apple Developer Team ID. */
  teamId: string;
  /** Key ID from the Apple Developer portal. */
  keyId: string;
  /** PKCS8 PEM content of the .p8 private key file. */
  privateKey: string;
  /** Must exactly match the redirect URI registered with Apple. */
  redirectUri: string;
  /** Native app bundle id used as the id_token audience for native sign in. */
  nativeClientId?: string;
}

/**
 * Normalized identity claims returned after a successful Apple Sign In exchange.
 * `email` is optional: Apple only returns it on the first login for a given
 * `subject`. Callers persist it against the subject and look it up on repeat
 * logins.
 */
export interface AppleAuthClaims {
  /** Stable per-user per-app Apple user id (the id_token `sub`). */
  subject: string;
  /** User email. May be an Apple private relay address; absent on repeat logins. */
  email?: string;
  /** Whether Apple considers the email verified. */
  emailVerified: boolean;
  /** Display name derived from firstName + lastName, available only on first login. */
  name?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_AUTH_ENDPOINT = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_ENDPOINT = 'https://appleid.apple.com/auth/token';
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');

// Cached JWKS getter — reused across calls; jose re-fetches on key rotation.
const appleJwks = createRemoteJWKSet(APPLE_JWKS_URL);

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/** Computes the S256 code_challenge from a plain code_verifier (matches oidc-service). */
function pkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

// ---------------------------------------------------------------------------
// Client secret
// ---------------------------------------------------------------------------

/**
 * Generates a short-lived ES256 JWT that Apple requires as the client_secret.
 * Apple mandates this be freshly signed per request (max 6-month expiry); we
 * use 5 minutes — just long enough for a single token exchange.
 */
export async function buildAppleClientSecret(config: AppleAuthConfig): Promise<string> {
  const privateKey = await importPKCS8(config.privateKey, 'ES256');

  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuedAt()
    .setIssuer(config.teamId)
    .setSubject(config.clientId)
    .setAudience(APPLE_ISSUER)
    .setExpirationTime('5m')
    .sign(privateKey);
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

/**
 * Builds the Apple Sign In authorization URL.
 * Uses PKCE (S256) and response_mode=form_post (Apple requirement). The caller
 * persists `codeVerifier` (and `nonce`) so they can be supplied to
 * `exchangeAppleCode` when Apple POSTs back.
 */
export async function buildAppleAuthorizationUrl(input: {
  config: AppleAuthConfig;
  state: string;
  codeVerifier: string;
  nonce?: string;
}): Promise<string> {
  const { config, state, codeVerifier, nonce } = input;
  const codeChallenge = pkceChallenge(codeVerifier);

  const url = new URL(APPLE_AUTH_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', 'name email');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('response_mode', 'form_post');
  if (nonce) url.searchParams.set('nonce', nonce);

  return url.toString();
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/** Raw shape of Apple's token endpoint response. */
interface AppleTokenResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Apple id_token payload fields we care about. */
interface AppleIdTokenPayload {
  sub?: string;
  email?: string;
  email_verified?: boolean | 'true' | 'false';
  is_private_email?: boolean | 'true' | 'false';
}

function deriveName(userName?: { firstName?: string | null; lastName?: string | null }): string | undefined {
  if (!userName) return undefined;
  const parts = [userName.firstName, userName.lastName]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function normalizeAppleClaims(payload: AppleIdTokenPayload, name: string | undefined): AppleAuthClaims {
  const subject = payload.sub;
  if (!subject) throw new Error('apple_missing_sub');
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  return {
    subject,
    // email is absent on repeat logins — callers look it up by subject.
    ...(payload.email ? { email: payload.email } : {}),
    emailVerified,
    ...(name !== undefined ? { name } : {}),
  };
}

/**
 * Exchanges the authorization code Apple posted to the redirect URI for an
 * id_token, verifies it against Apple's public JWKS, and returns normalized
 * `AppleAuthClaims`. Does NOT throw when email is missing — the route looks up
 * the stored email by subject.
 */
export async function exchangeAppleCode(input: {
  code: string;
  codeVerifier: string;
  config: AppleAuthConfig;
  userName?: { firstName?: string | null; lastName?: string | null };
}): Promise<AppleAuthClaims> {
  const { code, codeVerifier, config, userName } = input;

  // 1. Generate a fresh client_secret JWT.
  const clientSecret = await buildAppleClientSecret(config);

  // 2. Exchange authorization code for tokens.
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  });

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(APPLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch {
    throw new Error('apple_token_exchange_failed');
  }

  if (!tokenResponse.ok) {
    throw new Error('apple_token_exchange_failed');
  }

  let tokenJson: AppleTokenResponse;
  try {
    tokenJson = (await tokenResponse.json()) as AppleTokenResponse;
  } catch {
    throw new Error('apple_token_exchange_failed');
  }

  if (tokenJson.error) throw new Error('apple_token_exchange_failed');

  const rawIdToken = tokenJson.id_token;
  if (!rawIdToken) throw new Error('apple_missing_id_token');

  // 3. Verify the id_token against Apple's JWKS.
  let payload: AppleIdTokenPayload;
  try {
    const result = await jwtVerify(rawIdToken, appleJwks, {
      issuer: APPLE_ISSUER,
      audience: config.clientId,
      algorithms: ['RS256'],
    });
    payload = result.payload as unknown as AppleIdTokenPayload;
  } catch {
    throw new Error('apple_id_token_verification_failed');
  }

  return normalizeAppleClaims(payload, deriveName(userName));
}

/**
 * Verifies an Apple id_token presented directly by the native app (Sign in with
 * Apple via ASAuthorization). Accepts either the native bundle id or the web
 * Service ID as the audience.
 */
export async function verifyAppleIdentityToken(input: {
  identityToken: string;
  config: AppleAuthConfig;
  userName?: { firstName?: string | null; lastName?: string | null };
}): Promise<AppleAuthClaims> {
  const { identityToken, config, userName } = input;
  const audience = config.nativeClientId ?? config.clientId;

  let payload: AppleIdTokenPayload;
  try {
    const result = await jwtVerify(identityToken, appleJwks, {
      issuer: APPLE_ISSUER,
      audience,
      algorithms: ['RS256'],
    });
    payload = result.payload as unknown as AppleIdTokenPayload;
  } catch {
    throw new Error('apple_id_token_verification_failed');
  }

  return normalizeAppleClaims(payload, deriveName(userName));
}
