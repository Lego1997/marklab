# MarkLab — Multi-Provider Auth Activation Runbook

> **Audience:** Pan (operator). **Status:** the *code* for Google + Microsoft + Apple + email/password
> sign-in is complete on branch `feat/auth-providers-liquid-glass`. Everything below is the
> **manual activation** that only you can do, because it requires accounts, OAuth app registrations,
> and secrets that must never live in the repo.
>
> Nothing here has been executed by the agent. No invites were sent, no secrets were written, no
> deploy was run. Work top-to-bottom; each provider is independent — you can activate one at a time.

---

## 0. What was built (so you know what you're switching on)

The existing **Google OIDC** login (Gate 6) is unchanged. Three providers were added by *extending*
the same infrastructure — same `users` / `user_sessions` tables, same `ml_user_…` session tokens,
same `marklab_session` cookie. No parallel identity store was introduced.

| Provider | Web (browser) | Native macOS | Server route(s) |
|----------|---------------|--------------|-----------------|
| Google | ✅ already live | ✅ via browser deep-link (existing) | `POST /api/auth/oidc/start` `?provider=google`, `POST /api/auth/oidc/callback` |
| Microsoft | ✅ new | ✅ via browser deep-link | `POST /api/auth/oidc/start` `?provider=microsoft`, `POST /api/auth/oidc/callback` |
| Apple | ✅ new (web OIDC) | ✅ new (`Sign in with Apple` button) | `GET /api/auth/apple/start`, `POST /api/auth/apple/callback`, `POST /api/auth/apple/native` |
| Email + password | ✅ new | (browser) | `POST /api/auth/email/{register,login,reset-request,reset-confirm}`, `GET /api/auth/email/verify` |

Each provider **only activates when its env vars are present**. With no env vars set, the API behaves
exactly as it does today (Google only). So this is safe to roll out incrementally.

---

## 1. Database migration (do this first — required for Microsoft & email)

The migration is **idempotent** (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`), so it is
safe to run more than once and safe to run before any provider is configured.

File: `apps/api/src/db/migrations/0002_auth_providers.sql`

It adds:
- `oidc_login_states.provider` (varchar, default `'google'`) and `oidc_login_states.nonce` (text)
- `email_auth_credentials` (password hashes, keyed to `users(id)`)
- `email_verification_tokens` (verify + reset tokens)

**Run it against Neon** (from a shell with your Neon connection string):

```bash
# Option A: psql
psql "$DATABASE_URL" -f apps/api/src/db/migrations/0002_auth_providers.sql

# Option B: Neon SQL editor — paste the file contents and Run.
```

Verify: `\dt` should now list `email_auth_credentials` and `email_verification_tokens`, and
`\d oidc_login_states` should show the `provider` and `nonce` columns.

---

## 2. Google (already configured — just confirm)

Google is already live from Gate 6. No action needed unless you rotate credentials. For reference,
its env vars are: `MARKLAB_OIDC_ISSUER` (`https://accounts.google.com`), `MARKLAB_OIDC_CLIENT_ID`,
`MARKLAB_OIDC_CLIENT_SECRET`, `MARKLAB_OIDC_REDIRECT_URI`
(`https://marklab-relay-alpha.fly.dev/api/auth/oidc/callback`).

> The redirect URI for Google **and** Microsoft is the **same** shared OIDC callback. Make sure both
> providers' app registrations list it.

---

## 3. Microsoft (Entra ID / personal accounts) — Azure Portal

1. Go to **portal.azure.com → Microsoft Entra ID → App registrations → New registration**.
2. **Name:** `MarkLab`. **Supported account types:** for a single-org pilot choose *Accounts in this
   organizational directory only* (single tenant). If you need more than one org, you may pick a
   multi-tenant option — but MarkLab will only admit tenants you explicitly allowlist (step 6), never
   the open world.
3. **Redirect URI:** platform **Web**, value
   `https://marklab-relay-alpha.fly.dev/api/auth/oidc/callback`.
4. After creation, copy the **Application (client) ID** → `MARKLAB_MICROSOFT_CLIENT_ID`, **and** the
   **Directory (tenant) ID** → `MARKLAB_MICROSOFT_TENANT_ID`.
5. **Certificates & secrets → New client secret** → copy the **Value** (not the ID) →
   `MARKLAB_MICROSOFT_CLIENT_SECRET`. (Secrets expire — note the expiry; set a reminder.)
6. *(Multi-tenant only)* set `MARKLAB_MICROSOFT_ALLOWED_TENANT_IDS` to a comma-separated list of the
   Directory (tenant) IDs you trust. For single-tenant this defaults to `MARKLAB_MICROSOFT_TENANT_ID`.
7. **API permissions:** the default `User.Read` + delegated `openid email profile` is sufficient.

> **Security (important — read this).** MarkLab deliberately does **not** use the open `/common/`
> multi-tenant endpoint. A security review found that `/common/` combined with email-based account
> linking would let anyone with any Microsoft account assert a victim's email and take over their
> account. So MarkLab **pins the issuer to your tenant**, **cryptographically verifies the id_token**
> (Apple/Microsoft JWKS, RS256) and checks its `tid` against your allowlist, and **requires a verified
> email — exactly like Google**. Consequence: a concrete `MARKLAB_MICROSOFT_TENANT_ID` is **required**
> and the server refuses to boot if it is set to `common`/`organizations`/`consumers`. Personal
> `@outlook.com` accounts are admitted only if you allowlist the consumer tenant
> (`9188040d-6c67-4c5b-b112-36a304b66dad`). Safely re-opening to broad multi-tenant (identity keyed on
> the verified `sub` instead of email) is tracked as a follow-up issue.

---

## 4. Apple — Apple Developer portal

Apple Sign-In has **two** sub-paths that share most setup: the **web** flow (works in any browser /
the hosted `/signin` page) and the **native** macOS button. Web is simpler; do it first.

### 4a. Common setup (developer.apple.com → Certificates, Identifiers & Profiles)

1. **App ID** (Identifiers → +): a primary App ID for the macOS app (e.g. `com.marklab.app`).
   Enable the **Sign in with Apple** capability on it. Note this bundle id → it becomes
   `MARKLAB_APPLE_NATIVE_CLIENT_ID` (used to validate native id-tokens).
2. **Services ID** (Identifiers → + → *Services IDs*): e.g. `com.marklab.web`. This is the **web**
   client id → `MARKLAB_APPLE_CLIENT_ID`. Enable **Sign in with Apple**, click **Configure**:
   - **Primary App ID:** the App ID from step 1.
   - **Domains:** `marklab-relay-alpha.fly.dev`
   - **Return URLs:** `https://marklab-relay-alpha.fly.dev/api/auth/apple/callback`
3. **Key** (Keys → +): name `MarkLab Sign in with Apple`, enable **Sign in with Apple**, configure
   its primary App ID, **Register**, then **Download the `.p8` file once** (you cannot re-download).
   - The **Key ID** (10 chars) → `MARKLAB_APPLE_KEY_ID`.
   - Your **Team ID** (top-right of the portal, 10 chars) → `MARKLAB_APPLE_TEAM_ID`.
   - The **contents of the `.p8`** (the full `-----BEGIN PRIVATE KEY-----…` block) →
     `MARKLAB_APPLE_PRIVATE_KEY`. When setting it as a Fly secret, preserve the newlines (see §6).

### 4b. Native macOS button (extra requirements)

The native `Sign in with Apple` button only works in a **signed** app whose entitlements include
`com.apple.developer.applesignin`. The current pilot build is **ad-hoc signed**, so the native
button will **gracefully fall back to the browser Apple flow** until you:
1. Add the `com.apple.developer.applesignin` entitlement to the macOS app target (see
   `docs/ops/native-apple-signin.md`, written alongside the code).
2. Sign with a Developer ID / provisioning profile that has the Sign in with Apple capability
   (this dovetails with **Gate 10.5** signed distribution — PAN-8).

Until then, web Apple Sign-In (§4a) is fully functional and is the recommended pilot path.

---

## 5. Email + password (optional) — Resend

1. Create a **resend.com** account; **verify a sending domain** (or use the Resend test domain for
   internal testing only).
2. Create an **API key** → `MARKLAB_RESEND_API_KEY`.
3. Choose a From address on the verified domain → `MARKLAB_EMAIL_FROM`
   (e.g. `MarkLab <noreply@marklab.app>`).

Email/password routes (`/api/auth/email/*`) only mount when **both** `MARKLAB_RESEND_API_KEY` and
`MARKLAB_EMAIL_FROM` are set. Verification + reset links point at the web app
(`${MARKLAB_PUBLIC_WEB_URL}/auth/verify` and `/auth/reset`).

---

## 6. Set Fly secrets + redeploy

> ⚠️ The Fly CLI in the agent's shell is **unauthenticated** — the agent cannot deploy. Run these
> from your own authenticated shell.

```bash
# Microsoft (single-tenant). Add MARKLAB_MICROSOFT_ALLOWED_TENANT_IDS only for multi-tenant.
fly secrets set -a marklab-relay-alpha \
  MARKLAB_MICROSOFT_CLIENT_ID="…" \
  MARKLAB_MICROSOFT_CLIENT_SECRET="…" \
  MARKLAB_MICROSOFT_TENANT_ID="<your-directory-tenant-id-guid>"

# Apple (web). The private key has newlines — read it from the .p8 file directly:
fly secrets set -a marklab-relay-alpha \
  MARKLAB_APPLE_CLIENT_ID="com.marklab.web" \
  MARKLAB_APPLE_TEAM_ID="XXXXXXXXXX" \
  MARKLAB_APPLE_KEY_ID="YYYYYYYYYY" \
  MARKLAB_APPLE_NATIVE_CLIENT_ID="com.marklab.app" \
  MARKLAB_APPLE_PRIVATE_KEY="$(cat AuthKey_YYYYYYYYYY.p8)"

# Email (optional)
fly secrets set -a marklab-relay-alpha \
  MARKLAB_RESEND_API_KEY="…" \
  MARKLAB_EMAIL_FROM="MarkLab <noreply@your-domain>"
```

`fly secrets set` triggers a rolling redeploy automatically. Then confirm health:

```bash
curl -fsS https://marklab-relay-alpha.fly.dev/healthz   # expect ok:true
```

---

## 7. Verify each provider end-to-end

1. Open `https://marklab-relay-alpha.fly.dev/signin` — you should see **Continue with Google /
   Microsoft / Apple** + an email form.
2. Click each configured provider → complete the IdP flow → you should land signed in with a
   `marklab_session` cookie set, and `GET /api/auth/session` should return `authenticated: true`.
3. Email: register → check inbox → click verify → sign in → confirm session.
4. Native app: open MarkLab.app → Settings → the sign-in card shows all three providers; the browser
   buttons open `/signin?native=1` and complete via the `marklab://auth/callback` deep link.

---

## 8. Environment variable reference (source of truth)

| Variable | Provider | Required when | Notes |
|----------|----------|---------------|-------|
| `MARKLAB_OIDC_ISSUER` | Google | Google | `https://accounts.google.com` (existing) |
| `MARKLAB_OIDC_CLIENT_ID` | Google | Google | existing |
| `MARKLAB_OIDC_CLIENT_SECRET` | Google | Google | existing |
| `MARKLAB_OIDC_REDIRECT_URI` | Google + Microsoft | Google/MS | shared OIDC callback |
| `MARKLAB_MICROSOFT_CLIENT_ID` | Microsoft | Microsoft | Azure Application (client) ID |
| `MARKLAB_MICROSOFT_CLIENT_SECRET` | Microsoft | Microsoft | Azure client secret **Value** |
| `MARKLAB_MICROSOFT_TENANT_ID` | Microsoft | Microsoft | **Required.** Directory (tenant) ID; `common`/`organizations`/`consumers` rejected at boot |
| `MARKLAB_MICROSOFT_ALLOWED_TENANT_IDS` | Microsoft | multi-tenant only | comma-separated `tid` allowlist; defaults to `MARKLAB_MICROSOFT_TENANT_ID` |
| `MARKLAB_APPLE_CLIENT_ID` | Apple (web) | Apple web | the **Services ID** |
| `MARKLAB_APPLE_TEAM_ID` | Apple | Apple | 10-char Team ID |
| `MARKLAB_APPLE_KEY_ID` | Apple | Apple | 10-char Key ID |
| `MARKLAB_APPLE_PRIVATE_KEY` | Apple | Apple | full `.p8` contents (keep newlines) |
| `MARKLAB_APPLE_NATIVE_CLIENT_ID` | Apple (native) | native only | the app **bundle id** |
| `MARKLAB_RESEND_API_KEY` | Email | email | Resend API key |
| `MARKLAB_EMAIL_FROM` | Email | email | verified From address |
| `MARKLAB_PUBLIC_WEB_URL` | all | always | existing; used for verify/reset links + native redirect |
| `MARKLAB_PUBLIC_API_URL` | all | always | existing |

> **Secrets hygiene:** never commit any of the above to the repo. The `.p8` file and all client
> secrets are sensitive. Repo protected globs already block `.env*`, `*secret*`, `*key*`.

---

## 9. Rollback

Each provider is config-gated, so the fastest rollback is to **unset its secrets** and redeploy:
`fly secrets unset -a marklab-relay-alpha MARKLAB_MICROSOFT_CLIENT_ID …`. The migration is additive
and safe to leave in place. Google is never affected by the new providers' config.
