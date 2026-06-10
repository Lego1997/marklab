import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { DbPool } from '../db/client';
import { USER_SESSION_COOKIE, createUserSession } from '../services/user-service';
import {
  confirmPasswordReset,
  loginWithEmail,
  registerWithEmail,
  requestPasswordReset,
  sendVerificationEmail,
  verifyEmailToken,
} from '../services/email-auth-service';

export interface EmailAuthRouteOptions {
  /** Whether to set the Secure flag on the session cookie. */
  cookieSecure?: boolean;
  /** Resend API key used to send verification/reset emails. */
  resendApiKey: string;
  /** Sender address, e.g. 'MarkLab <noreply@marklab.app>'. */
  emailFrom: string;
  /** Public base URL of the API; used to build the verify link. */
  apiBaseUrl: string;
  /** Public base URL of the web app; used to build the reset link + verified redirect. */
  webBaseUrl: string;
}

const USER_SESSION_COOKIE_PATH = '/api';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(512),
  displayName: z.string().min(1).max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(512),
});

const resetRequestSchema = z.object({
  email: z.string().email(),
});

const resetConfirmSchema = z.object({
  token: z.string().min(1).max(512),
  newPassword: z.string().min(1).max(512),
});

function sessionCookie(token: string, options: EmailAuthRouteOptions): string {
  const secure = options.cookieSecure ? '; Secure' : '';
  return `${USER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=${USER_SESSION_COOKIE_PATH}; HttpOnly; SameSite=Lax${secure}`;
}

function clearLegacyRootSessionCookie(options: EmailAuthRouteOptions): string {
  const secure = options.cookieSecure ? '; Secure' : '';
  return `${USER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/**
 * Creates email+password auth routes. Mount in app.ts only when email is
 * configured:
 *   app.use('/api/auth/email', createEmailAuthRoutes(pool, options));
 */
export function createEmailAuthRoutes(pool: DbPool, options: EmailAuthRouteOptions): Router {
  const router = Router();

  router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = registerSchema.parse(req.body);
      const { userId, created } = await registerWithEmail(pool, {
        email: body.email,
        password: body.password,
        ...(body.displayName ? { displayName: body.displayName } : {}),
      });

      // Only send a verification email when fresh credentials were created.
      // If the email is already registered we intentionally do nothing extra
      // and return the same 201 response below, so the endpoint cannot be used
      // to enumerate which emails have accounts.
      if (created) {
        await sendVerificationEmail(pool, {
          userId,
          email: body.email,
          resendApiKey: options.resendApiKey,
          fromEmail: options.emailFrom,
          apiBaseUrl: options.apiBaseUrl,
        }).catch(() => undefined); // non-fatal: user can request another verification email
      }

      res.status(201).json({ message: 'Check your email to verify your account.' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = loginSchema.parse(req.body);
      const result = await loginWithEmail(pool, { email: body.email, password: body.password });
      const session = await createUserSession(pool, {
        provider: 'email',
        subject: result.email ?? body.email.trim().toLowerCase(),
        email: result.email ?? body.email,
        ...(result.displayName ? { name: result.displayName } : {}),
      });
      res.setHeader('set-cookie', [sessionCookie(session.token, options), clearLegacyRootSessionCookie(options)]);
      res.status(201).json(session);
    } catch (error) {
      next(error);
    }
  });

  // GET /verify?token=... — handles the link clicked in the verification email,
  // then 302-redirects back to the web sign-in page.
  router.get('/verify', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token : undefined;
      if (!token) throw new Error('invalid_or_expired_token');
      await verifyEmailToken(pool, token);
      res.redirect(302, `${options.webBaseUrl.replace(/\/$/u, '')}/signin?verified=1`);
    } catch (error) {
      next(error);
    }
  });

  // POST /reset-request — always returns 200 to prevent email enumeration.
  router.post('/reset-request', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = resetRequestSchema.parse(req.body);
      await requestPasswordReset(pool, {
        email: body.email,
        resendApiKey: options.resendApiKey,
        fromEmail: options.emailFrom,
        webBaseUrl: options.webBaseUrl,
      });
      res.status(200).json({ message: 'If that email is registered, a reset link is on its way.' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/reset-confirm', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = resetConfirmSchema.parse(req.body);
      await confirmPasswordReset(pool, { token: body.token, newPassword: body.newPassword });
      res.status(200).json({ message: 'Password updated. You can now sign in.' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
