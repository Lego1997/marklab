import { useState, useEffect, type FormEvent, type ReactElement } from 'react';
import { MARKLAB_API_URL } from '@marklab/collab-editor';
import { LoaderCircle, TriangleAlert, ExternalLink, CircleCheck } from 'lucide-react';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

const API_BASE: string = MARKLAB_API_URL;

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function webOrigin(): string {
  return window.location.origin;
}

function defaultRedirect(url: string): void {
  window.location.assign(url);
}

// ---------------------------------------------------------------------------
// Low-level fetch helper
// ---------------------------------------------------------------------------

async function parseResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  const data: unknown = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const code =
      data &&
      typeof data === 'object' &&
      'error' in (data as Record<string, unknown>) &&
      typeof (data as Record<string, string>).error === 'string'
        ? (data as Record<string, string>).error
        : `http_${res.status}`;
    throw new Error(code);
  }
  return data;
}

function assertObject(value: unknown, tag: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`invalid_${tag}`);
  }
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Error message formatter
// ---------------------------------------------------------------------------

function formatAuthError(code: string): string {
  switch (code) {
    case 'oidc_not_configured':
      return 'Sign-in is not configured for this environment.';
    case 'oidc_login_failed':
    case 'oidc_code_exchange_failed':
    case 'oidc_userinfo_failed':
      return 'Sign-in could not be completed. Try again or ask the operator for a fresh invite.';
    case 'missing_oidc_callback':
      return 'The sign-in response is missing required details.';
    case 'invalid_oidc_start_response':
    case 'invalid_auth_callback_response':
    case 'invalid_auth_token':
    case 'invalid_auth_user':
    case 'invalid_auth_email':
    case 'invalid_auth_display_name':
      return 'The sign-in response was not recognized.';
    case 'native_auth_state_required':
      return 'Open sign-in from MarkLab.app and try again.';
    case 'email_not_found':
      return 'No account found for that email address.';
    case 'invalid_credentials':
      return 'Incorrect email or password.';
    case 'email_already_registered':
      return 'An account with that email already exists.';
    case 'otp_invalid':
      return 'That code is invalid. Please request a new one.';
    case 'otp_expired':
      return 'That code has expired. Please request a new one.';
    default:
      return 'Sign-in failed. Try again or ask the operator to check the deployment.';
  }
}

// ---------------------------------------------------------------------------
// Callback response validation (OIDC flow)
// ---------------------------------------------------------------------------

interface AuthCallbackUser {
  userId: string;
  email: string;
  displayName: string;
}

interface AuthCallbackResponse {
  token: string;
  user: AuthCallbackUser;
  nativeCallback?: boolean;
  nativeAppState?: string;
  returnTo?: string;
}

function validateCallbackResponse(raw: unknown): AuthCallbackResponse {
  const resp = assertObject(raw, 'auth_callback_response');
  const user = assertObject(resp['user'], 'auth_user');
  if (typeof resp['token'] !== 'string' || !resp['token']) throw new Error('invalid_auth_token');
  if (typeof user['userId'] !== 'string' || !user['userId']) throw new Error('invalid_auth_user');
  if (typeof user['email'] !== 'string') throw new Error('invalid_auth_email');
  if (typeof user['displayName'] !== 'string' || !String(user['displayName']).trim())
    throw new Error('invalid_auth_display_name');
  return resp as unknown as AuthCallbackResponse;
}

function buildNativeCallbackUrl(resp: AuthCallbackResponse): string {
  const url = new URL('marklab://auth/callback');
  url.searchParams.set('token', resp.token);
  url.searchParams.set('apiBaseURL', API_BASE || webOrigin());
  url.searchParams.set('webBaseURL', webOrigin());
  url.searchParams.set('userId', resp.user.userId);
  url.searchParams.set('email', resp.user.email);
  url.searchParams.set('displayName', resp.user.displayName);
  if (resp.nativeAppState) url.searchParams.set('appState', resp.nativeAppState);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Google logo SVG
// ---------------------------------------------------------------------------

function GoogleLogo() {
  return (
    <svg
      className="auth-provider-logo"
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable={false}
    >
      <path
        fill="#4285f4"
        d="M17.6 9.2c0-.6-.1-1.1-.2-1.6H9v3.1h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.8c1.7-1.5 2.8-3.7 2.8-6.4Z"
      />
      <path
        fill="#34a853"
        d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9a5.4 5.4 0 0 1-5.1-3.7H1v2.3A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#fbbc05"
        d="M3.9 10.8a5.4 5.4 0 0 1 0-3.6V4.9H1a9 9 0 0 0 0 8.2l2.9-2.3Z"
      />
      <path
        fill="#ea4335"
        d="M9 3.6c1.3 0 2.5.5 3.4 1.3L15 2.4A9 9 0 0 0 1 4.9l2.9 2.3A5.4 5.4 0 0 1 9 3.6Z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Microsoft logo SVG
// ---------------------------------------------------------------------------

function MicrosoftLogo() {
  return (
    <svg
      className="auth-provider-logo"
      viewBox="0 0 21 21"
      aria-hidden="true"
      focusable={false}
    >
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Apple logo SVG
// ---------------------------------------------------------------------------

function AppleLogo() {
  return (
    <svg
      className="auth-provider-logo"
      viewBox="0 0 814 1000"
      aria-hidden="true"
      focusable={false}
    >
      <path
        fill="currentColor"
        d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 454.5 32.6 332.7 32.6 266.7c0-105 71.9-162.8 143.6-162.8 50.9 0 93.5 32.6 125.1 32.6 28.8 0 77-34.1 135.8-34.1 22.4 0 108.2 1.9 168.3 94.3zm-188.6-141.4c29.4-35.2 50.3-84.5 50.3-133.8 0-6.4-.6-13-1.9-18.1-47.6 1.9-104.4 31.9-138.2 71.6-26.3 30.1-51.5 79.4-51.5 130.8 0 7.1 1.3 14.1 1.9 16.4 3.2.6 8.4 1.3 13.5 1.3 43.4 0 98.1-29.1 125.9-68.2z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

function OrDivider() {
  return (
    <div className="auth-divider" role="separator" aria-label="or">
      <span>or</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmailLoginForm sub-component
// ---------------------------------------------------------------------------

type EmailMode = 'signin' | 'signup' | 'forgot';
type EmailStatus = 'idle' | 'submitting' | 'done' | 'failed';

interface EmailLoginFormProps {
  onSuccess?: () => void;
}

function EmailLoginForm({ onSuccess }: EmailLoginFormProps) {
  const [emailMode, setEmailMode] = useState<EmailMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [emailStatus, setEmailStatus] = useState<EmailStatus>('idle');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccessMessage, setEmailSuccessMessage] = useState<string | null>(null);

  function reset() {
    setEmailStatus('idle');
    setEmailError(null);
    setEmailSuccessMessage(null);
  }

  function switchMode(mode: EmailMode) {
    setEmailMode(mode);
    reset();
  }

  async function handleSignIn(ev: FormEvent) {
    ev.preventDefault();
    setEmailStatus('submitting');
    setEmailError(null);
    try {
      const res = await fetch(apiUrl('/api/auth/email/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      await parseResponse(res);
      setEmailStatus('done');
      if (onSuccess) {
        onSuccess();
      } else {
        defaultRedirect('/');
      }
    } catch (err) {
      setEmailStatus('failed');
      setEmailError(err instanceof Error ? err.message : 'sign_in_failed');
    }
  }

  async function handleSignUp(ev: FormEvent) {
    ev.preventDefault();
    if (password !== confirmPassword) {
      setEmailError('Passwords do not match.');
      return;
    }
    setEmailStatus('submitting');
    setEmailError(null);
    try {
      await parseResponse(
        await fetch(apiUrl('/api/auth/email/register'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, displayName: displayName.trim() || undefined }),
        }),
      );
      setEmailStatus('done');
      setEmailSuccessMessage(
        'Account created. Check your email for a verification link, then sign in.',
      );
    } catch (err) {
      setEmailStatus('failed');
      setEmailError(err instanceof Error ? err.message : 'sign_in_failed');
    }
  }

  async function handleForgotPassword(ev: FormEvent) {
    ev.preventDefault();
    setEmailStatus('submitting');
    setEmailError(null);
    try {
      await parseResponse(
        await fetch(apiUrl('/api/auth/email/reset-request'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        }),
      );
      setEmailStatus('done');
      setEmailSuccessMessage('Check your email for a password reset link.');
    } catch (err) {
      setEmailStatus('failed');
      setEmailError(err instanceof Error ? err.message : 'sign_in_failed');
    }
  }

  const submitting = emailStatus === 'submitting';

  if (emailStatus === 'done' && emailSuccessMessage) {
    return (
      <div className="auth-email-section">
        <p className="auth-success" role="status">
          <CircleCheck size={16} aria-hidden="true" />
          <span>{emailSuccessMessage}</span>
        </p>
        <button
          type="button"
          className="auth-text-btn"
          onClick={() => {
            reset();
            setEmailMode('signin');
          }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="auth-email-section">
      {emailMode === 'signin' && (
        <form onSubmit={(ev) => void handleSignIn(ev)} noValidate>
          <div className="auth-field">
            <label htmlFor="email-input">Email</label>
            <input
              id="email-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="password-input">Password</label>
            <input
              id="password-input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              disabled={submitting}
            />
          </div>
          {emailError && (
            <p className="auth-alert" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>{formatAuthError(emailError)}</span>
            </p>
          )}
          <button
            type="submit"
            className="auth-email-submit"
            disabled={submitting || !email || !password}
          >
            {submitting ? (
              <LoaderCircle className="auth-spin" size={16} aria-hidden="true" />
            ) : null}
            Sign in
          </button>
          <div className="auth-email-links">
            <button type="button" className="auth-text-btn" onClick={() => switchMode('forgot')}>
              Forgot password?
            </button>
            <button type="button" className="auth-text-btn" onClick={() => switchMode('signup')}>
              Create account
            </button>
          </div>
        </form>
      )}

      {emailMode === 'signup' && (
        <form onSubmit={(ev) => void handleSignUp(ev)} noValidate>
          <div className="auth-field">
            <label htmlFor="signup-email-input">Email</label>
            <input
              id="signup-email-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="signup-name-input">Display name</label>
            <input
              id="signup-name-input"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(ev) => setDisplayName(ev.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="signup-password-input">Password</label>
            <input
              id="signup-password-input"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="signup-confirm-input">Confirm password</label>
            <input
              id="signup-confirm-input"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(ev) => setConfirmPassword(ev.target.value)}
              disabled={submitting}
            />
          </div>
          {emailError && (
            <p className="auth-alert" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>{emailError.includes(' ') ? emailError : formatAuthError(emailError)}</span>
            </p>
          )}
          <button
            type="submit"
            className="auth-email-submit"
            disabled={submitting || !email || !password || !confirmPassword}
          >
            {submitting ? (
              <LoaderCircle className="auth-spin" size={16} aria-hidden="true" />
            ) : null}
            Create account
          </button>
          <div className="auth-email-links">
            <button type="button" className="auth-text-btn" onClick={() => switchMode('signin')}>
              Already have an account? Sign in
            </button>
          </div>
        </form>
      )}

      {emailMode === 'forgot' && (
        <form onSubmit={(ev) => void handleForgotPassword(ev)} noValidate>
          <p className="auth-copy" style={{ marginBottom: '12px' }}>
            Enter your email and we will send a reset link.
          </p>
          <div className="auth-field">
            <label htmlFor="forgot-email-input">Email</label>
            <input
              id="forgot-email-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              disabled={submitting}
            />
          </div>
          {emailError && (
            <p className="auth-alert" role="alert">
              <TriangleAlert size={16} aria-hidden="true" />
              <span>{formatAuthError(emailError)}</span>
            </p>
          )}
          <button type="submit" className="auth-email-submit" disabled={submitting || !email}>
            {submitting ? (
              <LoaderCircle className="auth-spin" size={16} aria-hidden="true" />
            ) : null}
            Send reset link
          </button>
          <div className="auth-email-links">
            <button type="button" className="auth-text-btn" onClick={() => switchMode('signin')}>
              Back to sign in
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SignInPage
// ---------------------------------------------------------------------------

type OidcProvider = 'google' | 'microsoft' | 'apple';

export interface SignInPageProps {
  nativeMode?: boolean;
  appState?: string | null;
  returnTo?: string | null;
  redirect?: (url: string) => void;
}

export function SignInPage({
  nativeMode = false,
  appState = null,
  returnTo = null,
  redirect: doRedirect = defaultRedirect,
}: SignInPageProps) {
  const [providerStatus, setProviderStatus] = useState<Record<OidcProvider, 'idle' | 'starting'>>({
    google: 'idle',
    microsoft: 'idle',
    apple: 'idle',
  });
  const [providerError, setProviderError] = useState<string | null>(null);
  const [errorProvider, setErrorProvider] = useState<OidcProvider | null>(null);

  async function startSignIn(provider: OidcProvider) {
    setProviderStatus((prev) => ({ ...prev, [provider]: 'starting' }));
    setProviderError(null);
    try {
      if (provider === 'apple') {
        // Apple uses a GET redirect, not a POST
        const params = new URLSearchParams();
        if (nativeMode) params.set('native', '1');
        if (nativeMode && appState) params.set('appState', appState);
        if (!nativeMode && returnTo) params.set('returnTo', returnTo);
        doRedirect(apiUrl(`/api/auth/apple/start?${params.toString()}`));
        return;
      }
      const res = await fetch(apiUrl('/api/auth/oidc/start'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          native: nativeMode,
          ...(nativeMode && appState ? { appState } : {}),
          ...(!nativeMode && returnTo ? { returnTo } : {}),
        }),
      });
      const data = assertObject(await parseResponse(res), 'oidc_start_response');
      if (typeof data['authorizationUrl'] !== 'string' || !data['authorizationUrl']) {
        throw new Error('invalid_oidc_start_response');
      }
      doRedirect(data['authorizationUrl'] as string);
    } catch (err) {
      setProviderStatus((prev) => ({ ...prev, [provider]: 'idle' }));
      setErrorProvider(provider);
      setProviderError(err instanceof Error ? err.message : 'sign_in_failed');
    }
  }

  const anyStarting = Object.values(providerStatus).some((s) => s === 'starting');

  const providerLabels: Record<OidcProvider, string> = {
    google: 'Continue with Google',
    microsoft: 'Continue with Microsoft',
    apple: 'Continue with Apple',
  };

  const providerLogos: Record<OidcProvider, ReactElement> = {
    google: <GoogleLogo />,
    microsoft: <MicrosoftLogo />,
    apple: <AppleLogo />,
  };

  const providerName: Record<OidcProvider, string> = {
    google: 'Google',
    microsoft: 'Microsoft',
    apple: 'Apple',
  };

  // Make the "not configured" message name the provider the user actually picked
  // (e.g. "Microsoft sign-in is not configured…"); other codes stay generic.
  function describeProviderError(code: string): string {
    if (code === 'oidc_not_configured' && errorProvider) {
      return `${providerName[errorProvider]} sign-in is not configured for this environment.`;
    }
    return formatAuthError(code);
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="auth-title">
        <h1 id="auth-title">Welcome to MarkLab</h1>
        <p className="auth-copy">Sign in or sign up to continue.</p>

        {(['google', 'microsoft', 'apple'] as OidcProvider[]).map((provider) => {
          const starting = providerStatus[provider] === 'starting';
          return (
            <button
              key={provider}
              className={`auth-provider auth-${provider}`}
              type="button"
              onClick={() => void startSignIn(provider)}
              disabled={anyStarting}
            >
              {starting ? (
                <LoaderCircle className="auth-spin" size={17} aria-hidden="true" />
              ) : (
                providerLogos[provider]
              )}
              <span>{starting ? `Opening ${provider}…` : providerLabels[provider]}</span>
            </button>
          );
        })}

        {providerError && (
          <p className="auth-alert" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{describeProviderError(providerError)}</span>
          </p>
        )}

        <OrDivider />

        <EmailLoginForm />
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// AuthCallbackPage  (/auth/callback)
// ---------------------------------------------------------------------------

export interface AuthCallbackPageProps {
  search?: string;
  redirect?: (url: string) => void;
}

export function AuthCallbackPage({
  search = window.location.search,
  redirect: doRedirect = defaultRedirect,
}: AuthCallbackPageProps) {
  const [status, setStatus] = useState<'loading' | 'done' | 'failed'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [nativeUrl, setNativeUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams(search);
    const code = params.get('code');
    const state = params.get('state');

    if (!code || !state) {
      setStatus('failed');
      setError('missing_oidc_callback');
      return;
    }

    async function exchange() {
      try {
        const res = await fetch(apiUrl('/api/auth/oidc/callback'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        });
        const raw = await parseResponse(res);
        if (cancelled) return;

        const resp = validateCallbackResponse(raw);

        if (resp.nativeCallback === true) {
          // A native handoff must carry the server-bound app state (the CSRF value
          // the native app generated). Refuse to hand a session token to the
          // marklab:// deep link without it.
          if (!resp.nativeAppState) throw new Error('invalid_auth_callback_response');
          const deepLink = buildNativeCallbackUrl(resp);
          setNativeUrl(deepLink);
          setStatus('done');
          doRedirect(deepLink);
          return;
        }

        if (resp.returnTo) {
          doRedirect(resp.returnTo);
          return;
        }

        setStatus('done');
      } catch (err) {
        if (cancelled) return;
        setStatus('failed');
        setError(err instanceof Error ? err.message : 'auth_callback_failed');
      }
    }

    void exchange();
    return () => {
      cancelled = true;
    };
  }, [doRedirect, search]);

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="auth-callback-title">
        <h1 id="auth-callback-title">Signing in</h1>
        {status === 'loading' && (
          <p className="auth-status" role="status">
            <LoaderCircle className="auth-spin" size={16} aria-hidden="true" />
            <span>Finishing sign-in...</span>
          </p>
        )}
        {status === 'done' && nativeUrl && (
          <a className="auth-provider auth-apple auth-link" href={nativeUrl}>
            <span>Open MarkLab</span>
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        )}
        {status === 'done' && !nativeUrl && (
          <p className="auth-success" role="status">
            <CircleCheck size={16} aria-hidden="true" />
            <span>Signed in.</span>
          </p>
        )}
        {error && (
          <p className="auth-alert" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{formatAuthError(error)}</span>
          </p>
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// EmailVerifyPage  (/auth/verify?token=...)
// ---------------------------------------------------------------------------

interface EmailVerifyPageProps {
  search?: string;
}

export function EmailVerifyPage({ search = window.location.search }: EmailVerifyPageProps) {
  const [status, setStatus] = useState<'loading' | 'done' | 'failed'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams(search);
    const token = params.get('token');

    if (!token) {
      setStatus('failed');
      setError('missing_verify_token');
      return;
    }

    async function verify() {
      try {
        await parseResponse(
          await fetch(apiUrl(`/api/auth/email/verify?token=${encodeURIComponent(token!)}`), {
            credentials: 'include',
          }),
        );
        if (cancelled) return;
        setStatus('done');
      } catch (err) {
        if (cancelled) return;
        setStatus('failed');
        setError(err instanceof Error ? err.message : 'verify_failed');
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [search]);

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="verify-title">
        <h1 id="verify-title">Email verification</h1>

        {status === 'loading' && (
          <p className="auth-status" role="status">
            <LoaderCircle className="auth-spin" size={16} aria-hidden="true" />
            <span>Verifying your email...</span>
          </p>
        )}

        {status === 'done' && (
          <>
            <p className="auth-success" role="status">
              <CircleCheck size={16} aria-hidden="true" />
              <span>Email verified. You can now sign in.</span>
            </p>
            <a className="auth-provider auth-apple" href="/signin">
              Sign in
            </a>
          </>
        )}

        {status === 'failed' && error && (
          <p className="auth-alert" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{formatAuthError(error)}</span>
          </p>
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// PasswordResetPage  (/auth/reset?token=...)
// ---------------------------------------------------------------------------

interface PasswordResetPageProps {
  search?: string;
}

export function PasswordResetPage({ search = window.location.search }: PasswordResetPageProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams(search);
  const token = params.get('token');

  async function handleSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setStatus('submitting');
    setError(null);
    try {
      await parseResponse(
        await fetch(apiUrl('/api/auth/email/reset-confirm'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, newPassword }),
        }),
      );
      setStatus('done');
    } catch (err) {
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'reset_failed');
    }
  }

  if (!token) {
    return (
      <main className="auth-page">
        <section className="auth-panel" aria-labelledby="reset-title">
          <h1 id="reset-title">Reset password</h1>
          <p className="auth-alert" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>Invalid or missing reset token.</span>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="reset-title">
        <h1 id="reset-title">Reset password</h1>

        {status === 'done' ? (
          <>
            <p className="auth-success" role="status">
              <CircleCheck size={16} aria-hidden="true" />
              <span>Password updated.</span>
            </p>
            <a className="auth-provider auth-apple" href="/signin">
              Sign in
            </a>
          </>
        ) : (
          <form onSubmit={(ev) => void handleSubmit(ev)} noValidate>
            <div className="auth-field">
              <label htmlFor="reset-new-password">New password</label>
              <input
                id="reset-new-password"
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(ev) => setNewPassword(ev.target.value)}
                disabled={status === 'submitting'}
              />
            </div>
            <div className="auth-field">
              <label htmlFor="reset-confirm-password">Confirm new password</label>
              <input
                id="reset-confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(ev) => setConfirmPassword(ev.target.value)}
                disabled={status === 'submitting'}
              />
            </div>
            {error && (
              <p className="auth-alert" role="alert">
                <TriangleAlert size={16} aria-hidden="true" />
                <span>{error.includes(' ') ? error : formatAuthError(error)}</span>
              </p>
            )}
            <button
              type="submit"
              className="auth-email-submit"
              disabled={status === 'submitting' || !newPassword || !confirmPassword}
            >
              {status === 'submitting' ? (
                <LoaderCircle className="auth-spin" size={16} aria-hidden="true" />
              ) : null}
              Update password
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
