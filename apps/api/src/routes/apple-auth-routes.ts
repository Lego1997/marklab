import { randomBytes } from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { OIDC_LOGIN_STATE_TTL_SECONDS } from '../config/provider-token-policy';
import type { DbPool } from '../db/client';
import { hashToken } from '../services/access-control';
import { USER_SESSION_COOKIE, createUserSession } from '../services/user-service';
import {
  buildAppleAuthorizationUrl,
  exchangeAppleCode,
  verifyAppleIdentityToken,
  type AppleAuthConfig,
} from '../services/apple-auth-service';

/**
 * Token-exchange seam mirroring `oidcExchange` in the OIDC routes. Defaults to
 * the real {@link exchangeAppleCode}; tests/smoke harnesses inject a fake to
 * avoid hitting Apple's token endpoint / JWKS over the network.
 */
export type AppleCodeExchange = typeof exchangeAppleCode;

export interface AppleAuthRouteOptions {
  /** Apple config; absent when Apple Sign In is not configured. */
  appleConfig?: AppleAuthConfig;
  cookieSecure?: boolean;
  /** Public base URL of the API; surfaced to the native app on the callback. */
  apiBaseUrl: string;
  /** Public base URL of the web app; surfaced to the native app on the callback. */
  webBaseUrl: string;
  /** Override the Apple authorization-code exchange (test/smoke injection seam). */
  exchangeAppleCode?: AppleCodeExchange;
}

const APPLE_PROVIDER = 'apple';
const APPLE_STATE_COOKIE = 'marklab_apple_state';
const APPLE_STATE_COOKIE_PATH = '/api/auth/apple';
const USER_SESSION_COOKIE_PATH = '/api';
const NATIVE_APP_HEADER = 'x-marklab-native-app';

const appleStartSchema = z.object({
  native: z
    .union([z.literal('1'), z.literal('true'), z.literal('false')])
    .optional(),
  appState: z.string().min(32).max(512).optional(),
  returnTo: z.string().min(1).max(1024).optional(),
});

const appleCallbackSchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(32).max(512),
  user: z.string().max(4096).optional(),
});

const appleNativeSchema = z.object({
  identityToken: z.string().min(1).max(8192),
  authorizationCode: z.string().min(1).max(4096).optional(),
  user: z
    .object({
      name: z
        .object({
          firstName: z.string().max(120).nullish(),
          lastName: z.string().max(120).nullish(),
        })
        .optional(),
    })
    .optional(),
});

function authToken(): string {
  return randomBytes(32).toString('base64url');
}

function appleStateCookie(state: string, options: AppleAuthRouteOptions): string {
  const secure = options.cookieSecure ? '; Secure' : '';
  return `${APPLE_STATE_COOKIE}=${encodeURIComponent(state)}; Path=${APPLE_STATE_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${OIDC_LOGIN_STATE_TTL_SECONDS}${secure}`;
}

function clearAppleStateCookie(options: AppleAuthRouteOptions): string {
  const secure = options.cookieSecure ? '; Secure' : '';
  return `${APPLE_STATE_COOKIE}=; Path=${APPLE_STATE_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function sessionCookie(token: string, options: AppleAuthRouteOptions): string {
  const secure = options.cookieSecure ? '; Secure' : '';
  return `${USER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=${USER_SESSION_COOKIE_PATH}; HttpOnly; SameSite=Lax${secure}`;
}

function clearLegacyRootSessionCookie(options: AppleAuthRouteOptions): string {
  const secure = options.cookieSecure ? '; Secure' : '';
  return `${USER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName || rawValue.length === 0) continue;
    try {
      cookies[rawName] = decodeURIComponent(rawValue.join('='));
    } catch {
      continue;
    }
  }
  return cookies;
}

function normalizeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

interface AppleUserName {
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * Apple POSTs the `user` field (a JSON string) only on the user's first login.
 * Parse it defensively; never let a malformed payload abort the exchange.
 */
function parseAppleUserName(raw: string | undefined): AppleUserName | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { name?: { firstName?: unknown; lastName?: unknown } };
    const name = parsed.name;
    if (!name) return undefined;
    const firstName = typeof name.firstName === 'string' ? name.firstName : null;
    const lastName = typeof name.lastName === 'string' ? name.lastName : null;
    if (firstName === null && lastName === null) return undefined;
    return { firstName, lastName };
  } catch {
    return undefined;
  }
}

async function lookupAppleEmailBySubject(pool: DbPool, subject: string): Promise<string | undefined> {
  const result = await pool.query<{ email: string | null }>(
    `select email from users where auth_provider = $1 and auth_subject = $2 limit 1`,
    [APPLE_PROVIDER, subject],
  );
  const email = result.rows[0]?.email;
  return email ?? undefined;
}

/**
 * Creates Apple Sign In routes (web form_post + native). Mount in app.ts only
 * when Apple is configured:
 *   app.use('/api/auth/apple', createAppleAuthRoutes(pool, options));
 */
export function createAppleAuthRoutes(pool: DbPool, options: AppleAuthRouteOptions): Router {
  const router = Router();
  const exchangeCode = options.exchangeAppleCode ?? exchangeAppleCode;

  // GET /api/auth/apple/start
  router.get('/start', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appleConfig = options.appleConfig;
      if (!appleConfig) throw new Error('oidc_not_configured');
      const query = appleStartSchema.parse(req.query);
      const nativeCallback = query.native === '1' || query.native === 'true';
      const nativeAppState = nativeCallback ? query.appState : null;
      if (nativeCallback && !nativeAppState) throw new Error('native_auth_state_required');
      const returnTo = normalizeReturnTo(query.returnTo);

      const state = authToken();
      const codeVerifier = authToken();
      const nonce = authToken();

      await pool.query(
        `insert into oidc_login_states
           (state_hash, code_verifier, native_callback, native_app_state, return_to, provider, nonce, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, now() + ($8 * interval '1 second'))`,
        [hashToken(state), codeVerifier, nativeCallback, nativeAppState, returnTo, APPLE_PROVIDER, nonce, OIDC_LOGIN_STATE_TTL_SECONDS],
      );

      const authorizationUrl = await buildAppleAuthorizationUrl({
        config: appleConfig,
        state,
        codeVerifier,
        nonce,
      });
      res.setHeader('set-cookie', appleStateCookie(state, options));
      res.redirect(302, authorizationUrl);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/auth/apple/callback — Apple form_post. Needs urlencoded parsing.
  router.post(
    '/callback',
    express.urlencoded({ extended: false, limit: '64kb' }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const appleConfig = options.appleConfig;
        if (!appleConfig) throw new Error('oidc_not_configured');
        const body = appleCallbackSchema.parse(req.body);
        const cookieState = parseCookieHeader(req.header('cookie'))[APPLE_STATE_COOKIE];
        if (!cookieState || cookieState !== body.state) throw new Error('oidc_login_state_invalid');

        const stateResult = await pool.query<{
          code_verifier: string;
          native_callback: boolean;
          native_app_state: string | null;
          return_to: string | null;
          provider: string | null;
        }>(
          `update oidc_login_states
              set used_at = now()
            where state_hash = $1
              and provider = $2
              and used_at is null
              and expires_at > now()
            returning code_verifier, native_callback, native_app_state, return_to, provider`,
          [hashToken(body.state), APPLE_PROVIDER],
        );
        const stateRow = stateResult.rows[0];
        const codeVerifier = stateRow?.code_verifier;
        if (!codeVerifier) throw new Error('oidc_login_state_invalid');

        const userName = parseAppleUserName(body.user);
        const claims = await exchangeCode({
          code: body.code,
          codeVerifier,
          config: appleConfig,
          ...(userName ? { userName } : {}),
        });

        // Never accept an unverified email from the id_token for account
        // creation/linking — symmetry with the OIDC path, and the unique
        // users.email column makes an unverified email a squatting vector. On
        // repeat logins claims.email is absent and recovered from the stored row.
        if (claims.email && !claims.emailVerified) throw new Error('apple_unverified_email');
        const email = claims.email ?? (await lookupAppleEmailBySubject(pool, claims.subject));
        if (!email) throw new Error('apple_email_unavailable');

        const session = await createUserSession(pool, {
          provider: APPLE_PROVIDER,
          subject: claims.subject,
          email,
          ...(claims.name ? { name: claims.name } : {}),
        });

        const cookies = [
          sessionCookie(session.token, options),
          clearAppleStateCookie(options),
          clearLegacyRootSessionCookie(options),
        ];
        res.setHeader('set-cookie', cookies);

        if (stateRow.native_callback) {
          const callbackUrl = new URL('marklab://auth/callback');
          callbackUrl.searchParams.set('token', session.token);
          callbackUrl.searchParams.set('apiBaseURL', options.apiBaseUrl);
          callbackUrl.searchParams.set('webBaseURL', options.webBaseUrl);
          callbackUrl.searchParams.set('userId', session.user.userId);
          callbackUrl.searchParams.set('email', session.user.email ?? email);
          callbackUrl.searchParams.set('displayName', session.user.displayName);
          if (stateRow.native_app_state) callbackUrl.searchParams.set('appState', stateRow.native_app_state);
          res.redirect(303, callbackUrl.toString());
          return;
        }

        res.redirect(303, normalizeReturnTo(stateRow.return_to) ?? `${options.webBaseUrl.replace(/\/$/u, '')}/`);
      } catch (error) {
        next(error);
      }
    },
  );

  // POST /api/auth/apple/native — native app presents an Apple identity token.
  router.post('/native', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.header(NATIVE_APP_HEADER) !== '1') throw new Error('unauthorized');
      const appleConfig = options.appleConfig;
      if (!appleConfig) throw new Error('oidc_not_configured');
      const body = appleNativeSchema.parse(req.body);
      const userName = body.user?.name
        ? {
            firstName: body.user.name.firstName ?? null,
            lastName: body.user.name.lastName ?? null,
          }
        : undefined;

      const claims = await verifyAppleIdentityToken({
        identityToken: body.identityToken,
        config: appleConfig,
        ...(userName ? { userName } : {}),
      });

      if (claims.email && !claims.emailVerified) throw new Error('apple_unverified_email');
      const email = claims.email ?? (await lookupAppleEmailBySubject(pool, claims.subject));
      if (!email) throw new Error('apple_email_unavailable');

      const session = await createUserSession(pool, {
        provider: APPLE_PROVIDER,
        subject: claims.subject,
        email,
        ...(claims.name ? { name: claims.name } : {}),
      });

      res.status(201).json({
        token: session.token,
        user: session.user,
        expiresAt: session.expiresAt,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
