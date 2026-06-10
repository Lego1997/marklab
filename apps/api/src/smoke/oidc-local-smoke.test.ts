import { describe, expect, it } from 'vitest';
import { runLocalOidcSmoke } from './oidc-local-smoke';

describe('local OIDC owner onboarding smoke', () => {
  it('exercises OIDC sign-in, bearer session auth, and self-serve workspace creation', async () => {
    const result = await runLocalOidcSmoke();

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual([
      'oidc_start_sets_state_cookie_and_authorization_url',
      'mock_oidc_authorize_redirects_with_code_and_state',
      'oidc_callback_exchanges_code_and_creates_owner_session',
      'bearer_session_authenticates_api_requests',
      'owner_can_list_empty_workspaces',
      'owner_can_create_self_serve_workspace',
      'created_workspace_is_listed_for_owner',
      'oidc_discovery_token_and_userinfo_endpoints_were_exercised',
      'microsoft_oidc_start_persists_provider_and_targets_microsoft_issuer',
      'microsoft_oidc_callback_mints_ml_user_session_via_provider_routed_exchange',
      'email_register_creates_unverified_credential',
      'email_login_rejected_until_verified',
      'email_login_after_verify_mints_ml_user_session',
      'email_login_rejects_wrong_password',
      'email_login_unknown_address_is_enumeration_safe',
      'apple_first_login_mints_ml_user_session_and_stores_email',
      'apple_repeat_login_recovers_email_by_subject_and_reuses_user',
    ]);
    expect(result.user).toEqual({
      userId: 'user_1',
      email: 'owner@example.test',
      displayName: 'Owner Smoke',
    });
    expect(result.workspace).toEqual({
      workspaceId: 'ws_1',
      name: 'Gate 6 Smoke Workspace',
      role: 'Owner',
    });
    expect(result.nativeCallbackUrl).toContain('marklab://auth/callback?token=REDACTED');
    expect(result.nativeCallbackUrl).toContain('displayName=Owner+Smoke');
    expect(result.oidcRequests).toEqual({
      authorizationRequests: 1,
      discoveryRequests: 2,
      tokenRequests: 1,
      userinfoRequests: 1,
    });

    // Microsoft OIDC: provider carried through login state, distinct user minted.
    expect(result.microsoft.provider).toBe('microsoft');
    expect(result.microsoft.email).toBe('microsoft-owner@example.test');
    expect(result.microsoft.userId).not.toBe(result.user.userId);
    expect(result.microsoft.oidcRequests).toEqual({
      authorizationRequests: 1,
      discoveryRequests: 2,
      tokenRequests: 1,
      userinfoRequests: 1,
    });

    // Email register -> verify -> login.
    expect(result.email).toEqual({
      userId: 'user_3',
      email: 'email-user@example.test',
    });

    // Apple: repeat login recovers email by subject without re-minting the user.
    expect(result.apple).toEqual({
      userId: 'user_4',
      email: 'apple-owner@example.test',
      subject: 'apple-sub-local-smoke',
      exchangeCalls: 2,
    });
  });
});
