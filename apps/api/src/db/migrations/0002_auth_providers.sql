-- 0002_auth_providers.sql
-- Multi-provider authentication (Microsoft OIDC, Apple Sign In, email+password).
-- Idempotent: safe to run repeatedly against an existing MarkLab control-plane
-- database on Neon. Builds on the existing users/user_sessions/oidc_login_states
-- primitives — does NOT introduce auth_users/auth_sessions/auth_identities.

-- 1. Persist the chosen provider + Apple nonce on OIDC login state rows.
alter table oidc_login_states
  add column if not exists provider varchar(32) not null default 'google';

alter table oidc_login_states
  add column if not exists nonce text;

-- 2. Email + password credentials, keyed by the shared users.id.
create table if not exists email_auth_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  password_hash text not null,
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Single-use email verification / password reset tokens (SHA-256 hashed).
create table if not exists email_verification_tokens (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  purpose varchar(32) not null check (purpose in ('verify_email', 'reset_password')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_verification_tokens_user_idx
  on email_verification_tokens (user_id);

create index if not exists email_verification_tokens_expiration_idx
  on email_verification_tokens (expires_at)
  where used_at is null;
