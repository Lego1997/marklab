import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { Resend } from 'resend';
import type { DbExecutor, DbPool } from '../db/client';
import { withTransaction } from '../db/client';
import { revokeAllUserSessions } from './user-service';

const TOKEN_VERIFY_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const TOKEN_RESET_TTL_SECONDS = 60 * 60; // 1 hour
const MIN_PASSWORD_LENGTH = 8;

// Email accounts are upserted into the shared `users` table with this provider,
// using the normalized email as the auth_subject.
const EMAIL_AUTH_PROVIDER = 'email';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

// ---- internal helpers ----

function hashEmailAuthToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

interface UserRow {
  id: string;
  email: string | null;
  display_name: string;
}

interface CredentialsLoginRow {
  user_id: string;
  password_hash: string;
  email_verified: boolean;
  email: string | null;
  display_name: string;
}

// ---- public API ----

export interface RegisterResult {
  userId: string;
  /**
   * Whether new email credentials were actually created. `false` means the
   * email already had credentials and nothing was changed. Callers MUST treat
   * both outcomes identically in their HTTP response to avoid leaking which
   * emails are registered (account enumeration) — see email-auth-routes.ts.
   */
  created: boolean;
}

/**
 * Finds an existing `users` row by normalized email or inserts a new one
 * (auth_provider='email', auth_subject=email), then inserts the credentials
 * row. Throws 'password_too_short' if the password is below the minimum length.
 *
 * Does NOT throw when credentials already exist for the email: it returns
 * `{ created: false }` so the route can respond identically regardless of
 * whether the email was already registered. Surfacing "already registered" as
 * a distinct status would let an unauthenticated attacker enumerate accounts;
 * the password reset flow already takes the same enumeration-safe stance.
 */
export async function registerWithEmail(
  pool: DbPool,
  input: { email: string; password: string; displayName?: string },
): Promise<RegisterResult> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error('password_too_short');
  }

  const normalizedEmail = normalizeEmail(input.email);
  const displayName = input.displayName?.trim() || normalizedEmail;
  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);

  return withTransaction(pool, async (client) => {
    // Find or create the shared users row for this email account.
    const existingUser = await client.query<UserRow>(
      `select id, email, display_name
         from users
        where auth_provider = $1 and auth_subject = $2
        limit 1`,
      [EMAIL_AUTH_PROVIDER, normalizedEmail],
    );

    let userId: string;
    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0]!.id;
    } else {
      const inserted = await client.query<{ id: string }>(
        `insert into users (email, display_name, auth_provider, auth_subject)
         values ($1, $2, $3, $4)
         returning id`,
        [normalizedEmail, displayName, EMAIL_AUTH_PROVIDER, normalizedEmail],
      );
      userId = inserted.rows[0]!.id;
    }

    // Insert credentials only if none exist yet. ON CONFLICT DO NOTHING keeps
    // this atomic and lets us detect the "already registered" case from the
    // absence of a returned row — without revealing it to the caller.
    const inserted = await client.query<{ user_id: string }>(
      `insert into email_auth_credentials (user_id, password_hash, email_verified)
       values ($1, $2, false)
       on conflict (user_id) do nothing
       returning user_id`,
      [userId, passwordHash],
    );

    return { userId, created: inserted.rows.length > 0 };
  });
}

export interface LoginResult {
  userId: string;
  email: string | null;
  displayName: string;
}

/**
 * Verifies email + password against the `users`/`email_auth_credentials` join.
 * Runs a dummy hash on a miss to keep timing constant, requires a verified
 * email, and transparently rehashes when argon2 parameters are upgraded.
 * Throws 'invalid_email_or_password' or 'email_not_verified'.
 */
export async function loginWithEmail(
  pool: DbPool,
  input: { email: string; password: string },
): Promise<LoginResult> {
  const normalizedEmail = normalizeEmail(input.email);

  const result = await pool.query<CredentialsLoginRow>(
    `select eac.user_id, eac.password_hash, eac.email_verified,
            u.email, u.display_name
       from email_auth_credentials eac
       join users u on u.id = eac.user_id
      where u.auth_provider = $1 and u.auth_subject = $2
      limit 1`,
    [EMAIL_AUTH_PROVIDER, normalizedEmail],
  );

  if (result.rows.length === 0) {
    // Run a dummy hash to prevent timing attacks that reveal unknown emails.
    await argon2.hash(input.password, ARGON2_OPTIONS).catch(() => undefined);
    throw new Error('invalid_email_or_password');
  }

  const row = result.rows[0]!;

  const matches = await argon2.verify(row.password_hash, input.password);
  if (!matches) {
    throw new Error('invalid_email_or_password');
  }

  if (!row.email_verified) {
    throw new Error('email_not_verified');
  }

  // Progressive rehash if parameters have been upgraded.
  if (argon2.needsRehash(row.password_hash, ARGON2_OPTIONS)) {
    const newHash = await argon2.hash(input.password, ARGON2_OPTIONS);
    await pool
      .query(
        `update email_auth_credentials set password_hash = $1, updated_at = now() where user_id = $2`,
        [newHash, row.user_id],
      )
      .catch(() => undefined); // non-fatal: next login will retry
  }

  return { userId: row.user_id, email: row.email, displayName: row.display_name };
}

/**
 * Generates a verification token, persists its hash, and sends a verification
 * email via Resend. The link points at the server route, which 302-redirects
 * back to the web app:
 *   {apiBaseUrl}/api/auth/email/verify?token={rawToken}
 */
export async function sendVerificationEmail(
  pool: DbExecutor,
  opts: {
    userId: string;
    email: string;
    resendApiKey: string;
    fromEmail: string;
    apiBaseUrl: string;
  },
): Promise<void> {
  const rawToken = generateRawToken();
  const tokenHash = hashEmailAuthToken(rawToken);

  await pool.query(
    `insert into email_verification_tokens (token_hash, user_id, purpose, expires_at)
     values ($1, $2, 'verify_email', now() + ($3 || ' seconds')::interval)`,
    [tokenHash, opts.userId, String(TOKEN_VERIFY_TTL_SECONDS)],
  );

  const verifyUrl = `${opts.apiBaseUrl.replace(/\/$/u, '')}/api/auth/email/verify?token=${encodeURIComponent(rawToken)}`;

  const resend = new Resend(opts.resendApiKey);
  const { error } = await resend.emails.send({
    from: opts.fromEmail,
    to: [opts.email],
    subject: 'Verify your MarkLab account',
    html: [
      '<p>Welcome to MarkLab!</p>',
      '<p>Click the link below to verify your email address. The link expires in 24 hours.</p>',
      `<p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
      '<p>If you did not sign up for MarkLab, you can ignore this email.</p>',
    ].join('\n'),
  });

  if (error) {
    throw new Error('email_send_failed');
  }
}

/**
 * Consumes a verify_email token and marks email_verified = true on the
 * credentials row. Throws 'invalid_or_expired_token' if the token is missing,
 * used, or expired.
 */
export async function verifyEmailToken(
  pool: DbPool,
  token: string,
): Promise<{ userId: string }> {
  const tokenHash = hashEmailAuthToken(token);

  // Atomically consume the token.
  const result = await pool.query<{ user_id: string }>(
    `update email_verification_tokens
        set used_at = now()
      where token_hash = $1
        and purpose = 'verify_email'
        and used_at is null
        and expires_at > now()
      returning user_id`,
    [tokenHash],
  );

  if (result.rows.length === 0) {
    throw new Error('invalid_or_expired_token');
  }

  const userId = result.rows[0]!.user_id;

  await pool
    .query(
      `update email_auth_credentials set email_verified = true, updated_at = now() where user_id = $1`,
      [userId],
    )
    .catch(() => undefined); // best-effort: non-fatal if row already removed

  return { userId };
}

/**
 * Generates a reset token and sends it via Resend. Always resolves
 * successfully — never reveals whether the email is registered. The link
 * points at the web app:
 *   {webBaseUrl}/auth/reset?token={rawToken}
 */
export async function requestPasswordReset(
  pool: DbPool,
  opts: {
    email: string;
    resendApiKey: string;
    fromEmail: string;
    webBaseUrl: string;
  },
): Promise<void> {
  const normalizedEmail = normalizeEmail(opts.email);

  const userResult = await pool.query<{ id: string }>(
    `select u.id
       from users u
       join email_auth_credentials eac on eac.user_id = u.id
      where u.auth_provider = $1 and u.auth_subject = $2
      limit 1`,
    [EMAIL_AUTH_PROVIDER, normalizedEmail],
  );

  // Always return without error even if no user found (prevent enumeration).
  if (userResult.rows.length === 0) return;

  const userId = userResult.rows[0]!.id;
  const rawToken = generateRawToken();
  const tokenHash = hashEmailAuthToken(rawToken);

  await pool.query(
    `insert into email_verification_tokens (token_hash, user_id, purpose, expires_at)
     values ($1, $2, 'reset_password', now() + ($3 || ' seconds')::interval)`,
    [tokenHash, userId, String(TOKEN_RESET_TTL_SECONDS)],
  );

  const resetUrl = `${opts.webBaseUrl.replace(/\/$/u, '')}/auth/reset?token=${encodeURIComponent(rawToken)}`;

  const resend = new Resend(opts.resendApiKey);
  await resend.emails
    .send({
      from: opts.fromEmail,
      to: [normalizedEmail],
      subject: 'Reset your MarkLab password',
      html: [
        '<p>You requested a password reset for your MarkLab account.</p>',
        '<p>Click the link below to choose a new password. The link expires in 1 hour.</p>',
        `<p><a href="${resetUrl}">${resetUrl}</a></p>`,
        '<p>If you did not request this, you can ignore this email.</p>',
      ].join('\n'),
    })
    .catch(() => undefined); // swallow send errors — caller must not learn of failure
}

/**
 * Consumes a reset_password token, updates the password hash, and revokes ALL
 * of the user's existing sessions so the reset evicts any attacker who already
 * holds a session token for the account. Throws 'password_too_short' or
 * 'invalid_or_expired_token'.
 */
export async function confirmPasswordReset(
  pool: DbPool,
  input: { token: string; newPassword: string },
): Promise<void> {
  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error('password_too_short');
  }

  const tokenHash = hashEmailAuthToken(input.token);
  const newHash = await argon2.hash(input.newPassword, ARGON2_OPTIONS);

  await withTransaction(pool, async (client) => {
    // Atomically consume the single-use reset token.
    const result = await client.query<{ user_id: string }>(
      `update email_verification_tokens
          set used_at = now()
        where token_hash = $1
          and purpose = 'reset_password'
          and used_at is null
          and expires_at > now()
        returning user_id`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      throw new Error('invalid_or_expired_token');
    }

    const userId = result.rows[0]!.user_id;

    await client.query(
      `update email_auth_credentials set password_hash = $1, updated_at = now() where user_id = $2`,
      [newHash, userId],
    );

    // Evict every outstanding session for this user. Without this, a reset
    // would not log out an attacker who hijacked a session — the primary
    // remediation users expect from "reset my password".
    await revokeAllUserSessions(client, userId);
  });
}
