import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AlphaLoginClaims } from './user-service';

/**
 * Optional id_token validation. When set, exchangeOidcCode verifies the
 * id_token returned by the token endpoint against the provider's JWKS and uses
 * its (cryptographically authenticated) claims — instead of trusting the
 * userinfo response — for sub/email/email_verified/tenant decisions.
 *
 * This is required for multi-tenant Microsoft (`/common`): without it an
 * attacker in any Azure tenant (or with a personal account) could present an
 * arbitrary, unverified `email`/`preferred_username` and be linked onto a
 * victim's account by email match alone.
 */
export interface OidcIdTokenValidation {
  /**
   * Allowed tenant ids (the `tid` claim). When non-empty, the id_token's `tid`
   * MUST be in this set. Pins multi-tenant endpoints to specific tenants so
   * logins from arbitrary/attacker tenants are rejected.
   */
  allowedTenantIds?: string[];
}

export interface OidcAuthConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationEndpoint?: string;
  requireEmailVerified?: boolean;
  requireDiscoveryIssuerMatch?: boolean;
  /**
   * When present, the id_token is verified against the provider JWKS and its
   * claims are treated as authoritative. Enables tenant pinning via `tid`.
   */
  idTokenValidation?: OidcIdTokenValidation;
}

export interface OidcExchangeInput {
  code: string;
  codeVerifier: string;
  config: OidcAuthConfig;
}

export type OidcExchange = (input: OidcExchangeInput) => Promise<AlphaLoginClaims>;

interface OidcDiscoveryDocument {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  userinfo_endpoint?: unknown;
  jwks_uri?: unknown;
}

interface OidcTokenResponse {
  access_token?: unknown;
  id_token?: unknown;
}

interface OidcIdTokenClaims extends JWTPayload {
  email?: unknown;
  email_verified?: unknown;
  preferred_username?: unknown;
  tid?: unknown;
}

interface OidcUserInfo {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  preferred_username?: unknown;
  name?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  picture?: unknown;
}

function endpointUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`oidc_missing_${field}`);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('oidc_insecure_endpoint');
    }
    return url.toString();
  } catch (error) {
    if (error instanceof Error && error.message === 'oidc_insecure_endpoint') throw error;
    throw new Error('oidc_discovery_failed');
  }
}

async function jsonResponse<T>(response: Response, errorMessage: string): Promise<T> {
  if (!response.ok) throw new Error(errorMessage);
  try {
    return await response.json() as T;
  } catch {
    throw new Error(errorMessage);
  }
}

async function fetchResponse(input: string, init: RequestInit | undefined, errorMessage: string): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error(errorMessage);
  }
}

async function discoverOidc(input: { issuer: string; errorMessage: string; requireIssuerMatch?: boolean | undefined }): Promise<OidcDiscoveryDocument> {
  const issuer = input.issuer.replace(/\/+$/u, '');
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  const discoveryResponse = await fetchResponse(discoveryUrl, { headers: { accept: 'application/json' } }, input.errorMessage);
  const discovery = await jsonResponse<OidcDiscoveryDocument>(discoveryResponse, input.errorMessage);
  // Microsoft's /common/ tenant returns a templated issuer (https://login.microsoftonline.com/{tenantid}/v2.0)
  // that never equals the configured issuer, so the issuer-match check is opt-out per provider.
  if (input.requireIssuerMatch !== false && typeof discovery.issuer === 'string' && discovery.issuer.replace(/\/+$/u, '') !== issuer) {
    throw new Error('oidc_issuer_mismatch');
  }
  return discovery;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function pkceChallenge(codeVerifier: string): string {
  return base64Url(createHash('sha256').update(codeVerifier).digest());
}

// Cache one remote JWKS getter per jwks_uri. jose handles key rotation and
// caching internally; we just avoid recreating the fetcher on every request.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, jwks);
  }
  return jwks;
}

/**
 * Verifies the id_token against the provider JWKS and enforces tenant pinning.
 * Returns the authenticated claims. The signature, audience (clientId) and a
 * non-empty `sub` are all required; for multi-tenant issuers the `tid` claim is
 * checked against the configured allowlist so logins from arbitrary tenants are
 * rejected.
 */
async function verifyOidcIdToken(input: {
  idToken: string;
  jwksUri: string;
  clientId: string;
  validation: OidcIdTokenValidation;
}): Promise<OidcIdTokenClaims> {
  let claims: OidcIdTokenClaims;
  try {
    const result = await jwtVerify(input.idToken, getJwks(input.jwksUri), {
      audience: input.clientId,
      algorithms: ['RS256'],
    });
    claims = result.payload as OidcIdTokenClaims;
  } catch {
    throw new Error('oidc_id_token_verification_failed');
  }

  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('oidc_invalid_claims');

  const allowedTenantIds = input.validation.allowedTenantIds ?? [];
  if (allowedTenantIds.length > 0) {
    const tid = typeof claims.tid === 'string' ? claims.tid : undefined;
    if (!tid || !allowedTenantIds.includes(tid)) {
      throw new Error('oidc_tenant_not_allowed');
    }
  }

  return claims;
}

export async function buildOidcAuthorizationUrl(input: {
  config: OidcAuthConfig;
  state: string;
  codeVerifier: string;
}): Promise<string> {
  const issuer = input.config.issuer.replace(/\/+$/u, '');
  const discovery = input.config.authorizationEndpoint
    ? undefined
    : await discoverOidc({ issuer, errorMessage: 'oidc_discovery_failed', requireIssuerMatch: input.config.requireDiscoveryIssuerMatch });
  const authorizationEndpoint = endpointUrl(input.config.authorizationEndpoint ?? discovery?.authorization_endpoint, 'authorization_endpoint');
  const url = new URL(authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.config.clientId);
  url.searchParams.set('redirect_uri', input.config.redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', pkceChallenge(input.codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeOidcCode(input: OidcExchangeInput): Promise<AlphaLoginClaims> {
  const issuer = input.config.issuer.replace(/\/+$/u, '');
  const discovery = await discoverOidc({ issuer, errorMessage: 'oidc_discovery_failed', requireIssuerMatch: input.config.requireDiscoveryIssuerMatch });
  const tokenEndpoint = endpointUrl(discovery.token_endpoint, 'token_endpoint');

  const tokenResponse = await fetchResponse(tokenEndpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      redirect_uri: input.config.redirectUri,
      code_verifier: input.codeVerifier,
    }),
  }, 'oidc_code_exchange_failed');
  const token = await jsonResponse<OidcTokenResponse>(tokenResponse, 'oidc_code_exchange_failed');
  if (typeof token.access_token !== 'string' || !token.access_token) throw new Error('oidc_code_exchange_failed');

  // When id_token validation is configured (e.g. multi-tenant Microsoft), trust
  // the cryptographically-verified id_token claims instead of the unauthenticated
  // userinfo response, and enforce the tenant allowlist.
  if (input.config.idTokenValidation) {
    if (typeof token.id_token !== 'string' || !token.id_token) throw new Error('oidc_code_exchange_failed');
    const jwksUri = endpointUrl(discovery.jwks_uri, 'jwks_uri');
    const idClaims = await verifyOidcIdToken({
      idToken: token.id_token,
      jwksUri,
      clientId: input.config.clientId,
      validation: input.config.idTokenValidation,
    });
    // Microsoft v2.0 may carry the address in `email` or `preferred_username` (the UPN).
    const email = typeof idClaims.email === 'string' && idClaims.email
      ? idClaims.email
      : (typeof idClaims.preferred_username === 'string' && idClaims.preferred_username.includes('@') ? idClaims.preferred_username : undefined);
    if (!email) throw new Error('oidc_invalid_claims');
    // Never honor an unverified email for account linking, regardless of the
    // requireEmailVerified flag: an unverified Microsoft email/UPN is attacker
    // controllable and would allow takeover via the unique users.email column.
    if (idClaims.email_verified !== true) throw new Error('oidc_unverified_email');
    const name = typeof idClaims.name === 'string' ? idClaims.name : undefined;
    const givenName = typeof idClaims.given_name === 'string' ? idClaims.given_name : undefined;
    const familyName = typeof idClaims.family_name === 'string' ? idClaims.family_name : undefined;
    const picture = typeof idClaims.picture === 'string' ? idClaims.picture : undefined;
    return {
      provider: issuer,
      subject: idClaims.sub as string,
      email,
      ...(name ? { name } : {}),
      ...(givenName ? { givenName } : {}),
      ...(familyName ? { familyName } : {}),
      ...(picture ? { picture } : {}),
    };
  }

  const userinfoEndpoint = endpointUrl(discovery.userinfo_endpoint, 'userinfo_endpoint');
  const userInfoResponse = await fetchResponse(userinfoEndpoint, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.access_token}`,
    },
  }, 'oidc_userinfo_failed');
  const userInfo = await jsonResponse<OidcUserInfo>(userInfoResponse, 'oidc_userinfo_failed');
  if (typeof userInfo.sub !== 'string' || !userInfo.sub) throw new Error('oidc_invalid_claims');
  const email = typeof userInfo.email === 'string' && userInfo.email ? userInfo.email : undefined;
  if (!email) throw new Error('oidc_invalid_claims');
  if (input.config.requireEmailVerified !== false && userInfo.email_verified !== true) throw new Error('oidc_unverified_email');

  return {
    provider: issuer,
    subject: userInfo.sub,
    email,
    ...(typeof userInfo.name === 'string' ? { name: userInfo.name } : {}),
    ...(typeof userInfo.given_name === 'string' ? { givenName: userInfo.given_name } : {}),
    ...(typeof userInfo.family_name === 'string' ? { familyName: userInfo.family_name } : {}),
    ...(typeof userInfo.picture === 'string' ? { picture: userInfo.picture } : {}),
  };
}
