# Native "Sign in with Apple" — enabling the entitlement

The macOS app ships a **native** Sign in with Apple button (`AppleSignIn.swift`,
`ASAuthorizationAppleIDProvider`). On success it posts the Apple identity token to
`POST /api/auth/apple/native`, which JWKS-verifies it and returns an `ml_user_…` session — the same
session model as the browser flow, but without leaving the app.

## Current behavior (ad-hoc pilot build)

Native Sign in with Apple requires the `com.apple.developer.applesignin` entitlement, which is only
honored on an app **signed** with a provisioning profile that carries the *Sign in with Apple*
capability. The pilot build is **ad-hoc signed**, so the native sheet will not complete. The button
therefore **gracefully falls back** to opening the browser Apple flow
(`{webBaseURL}/signin?native=1&appState=…`) — no crash, no dead end. Google/Microsoft already use
this browser path.

So: nothing to do for the pilot. The steps below are for when you want the *native* sheet, which
dovetails with **Gate 10.5 signed distribution (PAN-8)**.

## To enable the native sheet

1. **App ID** (developer.apple.com → Identifiers): on the macOS app's App ID (e.g.
   `com.marklab.app`) enable the **Sign in with Apple** capability.
2. **Entitlement:** add `com.apple.developer.applesignin = [Default]` to the app's `.entitlements`
   (in Xcode: target → Signing & Capabilities → **+ Sign in with Apple**).
3. **Signing:** build signed with a Developer ID / provisioning profile that includes the capability
   (part of Gate 10.5 — PAN-8). Plain `swift build` / ad-hoc signing will not carry the entitlement.
4. **Server:** set `MARKLAB_APPLE_NATIVE_CLIENT_ID` to the app's **bundle id** so the server validates
   the native id_token's `aud`. (See `docs/ops/auth-activation-runbook.md`.)
5. Rebuild + re-sign + distribute.

## Notes

- The **web** Apple flow (Apple *Services ID*) works regardless of signing and is the pilot path.
- One Apple Developer Team backs both the web Services ID and the native App ID.
- Hardening follow-ups for the native endpoint (require the native-client-id audience; add replay
  binding) are tracked in **PAN-35**.
