# PAN-5 Shared-File Startup Performance Pass

Date: 2026-05-30
Updated: 2026-05-31

Branch/worktree: `codex/pan-5-pilot-entry` at `7bba036f5d0a84e6140286fcd00df8f217d70dc4`, with local PAN-5 edits.

## Status

Passed for PAN-5. Packaged-app local mock-control-plane baseline/final timing, current-source native proxy timing, and a live owner/WebView timing pass now exist for both PAN-5 paths. The live pass used `/tmp/MarkLab-pan5-current.app` with the owner workspace/account env restored, waited for hosted editor readiness, and completed five samples with no readiness timeouts. The default Command Line Tools SwiftPM is still broken, but the local Swift 6.2.4 toolchain can run the focused native checks and package the app without changing global toolchain settings.

## Timing Boundaries

Start Sharing plus usable links:

- Start after the local Markdown file is already open and the user invokes Start Sharing or the CLI equivalent.
- Stop when Start Sharing has imported or resumed the cloud document and edit/view links are created and usable.
- Native model boundary: `MarkLabAppModel.startSharingAndConnectThrowing()` through `createLinkAndCopy(role:)`.

Already-shared reopen:

- Start at app launch/session restore plus reopening a file with an active shared-document binding.
- Stop when the app has restored shared state, set `embeddedCollabURL`, registered the session, and is ready to load the native web editor.
- Native model boundary: `MarkLabSharedSessionRestorer.restoreActiveSessions()` plus `MarkLabAppModel.loadFile(_:)`.

Known coverage gap:

- Native code now has a hosted WebView `editor-ready` signal and an opt-in CLI wait path. The local mock timing still stops at the native CLI response because the mock does not serve the real collab WebView. The live hosted pass below enables the readiness wait and proves the hidden WKWebView/editor path against the deployed alpha service.

## Baseline Evidence

Packaged-app native CLI timing was run against a local mock control plane with no owner secrets:

- Command: `PAN5_SAMPLE_COUNT=5 node scripts/pan5-native-cli-timing.mjs`
- Artifact: `/Users/pan/Library/CloudStorage/GoogleDrive-zhengfan.pan@gmail.com/My Drive/side projects/marklab-macos/dist/MarkLab.app`
- Timing method: launch packaged app with a temporary app-support directory, send native CLI share requests, use a local mock API for `/api/docs/import` and access grants, and wait for the native CLI response JSON.
- Markdown size: 240101 bytes.

| Path | Samples | Raw timings (ms) | Median | Mean | Min | Max |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Start Sharing to edit link | 5 | 5331.56, 1700.31, 1777.56, 1383.34, 1887.34 | 1777.56 | 2416.02 | 1383.34 | 5331.56 |
| Already-shared reopen to view link | 5 | 1742.42, 1579.64, 1738.39, 1581.29, 1631.17 | 1631.17 | 1654.59 | 1579.64 | 1742.42 |

What this proves:

- The packaged native app artifact can complete the local app-side Start Sharing/import/link path and an already-shared cold reopen/link path against a responsive control plane.
- The already-shared reopen proxy avoids a new import: the mock saw one import per sample, then two grant creations and one grant-list refresh for the same document.
- The first Start Sharing sample was a cold-launch outlier at 5331.56 ms; the remaining Start Sharing samples were 1383.34-1887.34 ms.

What this does not prove:

- Live hosted API/database/provider latency.
- Browser edit/view link load or WebView editor-ready timing.

## Rebuilt Current-Source Packaged-App Timing

The current source was packaged with the local Swift 6.2.4 toolchain and Sparkle feed/key env unset:

- Build command: `PATH="$HOME/Library/Developer/Toolchains/swift-6.2.4-RELEASE.xctoolchain/usr/bin:$PATH" MARKLAB_APP_VERSION=0.0.0-pan5-local MARKLAB_APP_BUILD=2 node apps/marklab-macos/scripts/package-app.mjs --skip-editor-build --output dist/MarkLab-pan5-current.app`
- Verified artifact for timing: `/tmp/MarkLab-pan5-current.app`
- Verification command: `node apps/marklab-macos/scripts/verify-packaged-app.mjs /tmp/MarkLab-pan5-current.app`
- Verification result: `ok: true`, ad-hoc signed, Sparkle linked, `sparkleUpdatesConfigured: false`, Developer ID/notarization/distribution-ready all false as expected for the bounded pilot artifact.
- Note: the same bundle under the Google Drive worktree path picked up File Provider/FinderInfo metadata that made strict codesign verification fail; repackaging the already-built binary to `/tmp` avoided cloud-provider xattrs.

The rebuilt artifact was timed with the same local mock-control-plane harness:

- Command: `MARKLAB_APP_PATH=/tmp/MarkLab-pan5-current.app PAN5_SAMPLE_COUNT=5 node scripts/pan5-native-cli-timing.mjs`
- Markdown size: 240101 bytes.

| Path | Samples | Raw timings (ms) | Median | Mean | Min | Max |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Start Sharing to edit link | 5 | 4462.42, 1291.93, 1198.56, 1190.79, 1778.71 | 1291.93 | 1984.48 | 1190.79 | 4462.42 |
| Already-shared reopen to view link | 5 | 1788.88, 1188.33, 1236.74, 1553.92, 1951.91 | 1553.92 | 1543.96 | 1188.33 | 1951.91 |

Local mock baseline-to-current comparison:

| Path | Baseline median | Current median | Delta |
| --- | ---: | ---: | ---: |
| Start Sharing to edit link | 1777.56 ms | 1291.93 ms | -485.63 ms |
| Already-shared reopen to view link | 1631.17 ms | 1553.92 ms | -77.25 ms |

What this proves:

- The current-source packaged app artifact still completes both native CLI share/reopen proxy paths against a responsive control plane.
- The targeted duplicate-read fix has current-source packaged-app coverage, not just unit/proxy coverage.
- On this local mock harness, Start Sharing median improved by about 486 ms versus the earlier packaged-app baseline.

What this does not prove:

- Live hosted API/database/provider latency.
- Browser edit/view link load or WebView editor-ready timing.
- Distribution readiness; this remains ad-hoc signed and not notarized by design for this PAN-5 pass.

## Live Hosted Owner/WebView Timing

Owner Google sign-in was completed in the app, which restored a stored MarkLab owner account and a private local timing env. The private env was sourced without printing token values.

The live timing pass used the rebuilt current-source app artifact:

- Command: `PAN5_USE_LIVE_HOSTED=1 PAN5_WAIT_FOR_WEBVIEW_READY=1 PAN5_KEEP_TIMING_TEMP=1 MARKLAB_APP_PATH=/tmp/MarkLab-pan5-current.app PAN5_SAMPLE_COUNT=5 node scripts/pan5-native-cli-timing.mjs`
- Artifact: `/tmp/MarkLab-pan5-current.app`
- Timing method: launch packaged app with temporary app support, send native CLI share requests, use the live hosted control plane at `https://marklab-relay-alpha.fly.dev`, create edit/view links, and wait for hosted WebView/editor readiness before the response JSON is written.
- Markdown size: 240101 bytes.
- Evidence temp root: `/var/folders/2g/4fhdcfk1431g086hfdvplpsc0000gn/T/marklab-pan5-native-cli-VS9vlV`

| Path | Samples | Raw timings (ms) | Median | Mean | Min | Max |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Start Sharing to edit link plus hosted editor ready | 5 | 14240.81, 12325.01, 12769.85, 14101.01, 13074.83 | 13074.83 | 13302.30 | 12325.01 | 14240.81 |
| Already-shared reopen to view link plus hosted editor ready | 5 | 11420.13, 10525.58, 9289.10, 8902.07, 9585.40 | 9585.40 | 9944.45 | 8902.07 | 11420.13 |

Hosted editor readiness wait only:

| Path | Samples | Raw timings (ms) | Median | Mean | Min | Max |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Start Sharing hosted editor readiness wait | 5 | 7486.15, 7576.20, 7429.97, 9243.76, 8380.33 | 7576.20 | 8023.28 | 7429.97 | 9243.76 |
| Already-shared reopen hosted editor readiness wait | 5 | 8693.88, 7538.56, 6540.51, 6215.82, 6590.57 | 6590.57 | 7115.87 | 6215.82 | 8693.88 |

One-sample preflight also passed:

- Command shape: same live hosted/WebView-ready command with `PAN5_SAMPLE_COUNT=1`.
- Result: Start Sharing to hosted-ready 19502.72 ms; already-shared reopen to hosted-ready 11514.55 ms; both responses reported `hostedEditorReady: true` and `hostedEditorReadyTimedOut: false`.

What this proves:

- The accepted PAN-5 timing harness can measure the real owner workspace path against the live hosted alpha service.
- Both Start Sharing and already-shared reopen reached hidden WKWebView/editor readiness within the 60-second readiness timeout in five consecutive samples.
- No sampled response timed out or failed link creation.

Important qualification:

- The deployed hosted bundle did not yet contain the new explicit `editor-ready` bridge marker, so the native app also includes a backward-compatible readiness fallback from the existing hosted markdown snapshot and disk-ingestion bridge messages. This fallback is still WebView-based and only fires after the deployed collaborative editor has produced a native bridge signal. The explicit `editor-ready` event remains tested locally and will become the preferred stop signal once the web bundle is deployed.

Read-only hosted alpha smoke passed earlier in the PAN-5 pass:

- `runAlphaSmoke()` against `https://marklab-relay-alpha.fly.dev` returned `ok: true`.
- `/healthz`, `/collab`, `/workspaces/smoke/settings`, and static assets passed.

## Hosted WebView Readiness Hook

The hosted MarkEdit WebView now publishes a native bridge message once the remote editor is actually ready:

- Hosted payload: `{ type: "editor-ready", editor: "codemirror", surface: "hosted-collab", providerStatus: "connected" }`.
- Hosted conditions: native app + MarkEdit shell, CodeMirror view exists, Yjs binding exists, native editor globals are installed, and provider status is connected.
- Native handling: `HostedEditorReadyBridgeResult.fromBridgePayload(_:)` validates the payload, `HostedCollabWebView.Coordinator` routes it, and `MarkLabAppModel.receiveHostedEditorReady(_:)` records both the validated result and `hostedEditorReadyAt`.
- Reset behavior: app/file/share/session transitions clear the stored readiness timestamp so future measurements are per-session.
- CLI timing consumption: native CLI requests can set `waitForHostedEditorReady` and `hostedEditorReadyTimeoutMs`; `NativeCLIShareAppService` retains the hidden background model, waits for the model's hosted readiness timestamp, and writes readiness fields into the CLI response.
- Script support: `scripts/pan5-native-cli-timing.mjs` supports `PAN5_USE_LIVE_HOSTED=1` with owner env vars and `PAN5_WAIT_FOR_WEBVIEW_READY=1` or `PAN5_WAIT_FOR_EDITOR_READY=1` to include readiness in the response-file timing boundary.
- Compatibility fallback: until the deployed hosted bundle carries the explicit `editor-ready` bridge marker, native readiness can also be satisfied by the existing hosted markdown snapshot or successful disk-ingestion bridge result.
- Hidden WKWebView support: the background shared-document host now orders an offscreen, non-interactive AppKit window with nonzero alpha so WebKit renders in the CLI timing path.
- Packaged-app support: `/tmp/MarkLab-pan5-current.app` was rebuilt after these changes with build `0.0.0-pan5-local`/`5`.

What this proves:

- The live WebView timing pass has a concrete native stop signal for remote editor readiness.
- The signal is intentionally stricter than `embeddedCollabURL` assignment and should not fire while provider status is still connecting.
- The PAN-5 timing script can now use that stop signal without a separate manual observer.

What this does not prove:

- Default local mock timing still does not prove WKWebView readiness because the mock server is not the live collab app/provider.
- The current deployed hosted bundle has not yet been updated to emit the explicit `editor-ready` event; the live pass relied on the backward-compatible native fallback from existing bridge traffic.

Current-source local Swift proxy timing was run with the local Swift 6.2.4 toolchain:

- Command: `$HOME/Library/Developer/Toolchains/swift-6.2.4-RELEASE.xctoolchain/usr/bin/swift test --package-path apps/marklab-macos --scratch-path /tmp/marklab-pan5-swift624-test-scratch --cache-path /tmp/marklab-pan5-swift624-test-cache --config-path /tmp/marklab-pan5-swift624-test-config --security-path /tmp/marklab-pan5-swift624-test-security --manifest-cache none --disable-dependency-cache --disable-keychain --skip-update --force-resolved-versions --filter PAN5StartupPerformanceProbeTests`
- `PAN5_PERF_PROBE` emitted 5 samples against local mock native boundaries with 792030 bytes of Markdown.

| Path | Samples | Raw timings (ms) | Median | Mean | Min | Max |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Start Sharing plus edit/view links | 5 | 76.52, 27.08, 26.60, 23.10, 23.84 | 26.60 | 35.43 | 23.10 | 76.52 |
| Already-shared reopen | 5 | 18.84, 14.62, 12.01, 12.49, 12.11 | 12.49 | 14.01 | 12.01 | 18.84 |

Default SwiftPM failure:

```text
error: 'marklab-macos': Invalid manifest
Undefined symbols for architecture arm64:
  PackageDescription.Package.__allocating_init(...)
```

Toolchain observed:

- `xcode-select -p` -> `/Library/Developer/CommandLineTools`
- `swift --version` -> Apple Swift `6.3.2`, target `arm64-apple-macosx26.0`
- No `Xcode*.app` was found under `/Applications` or `~/Applications`.
- Alternate safe toolchain: `/Users/pan/Library/Developer/Toolchains/swift-6.2.4-RELEASE.xctoolchain/usr/bin/swift` -> Apple Swift `6.2.4`, target `arm64-apple-macosx26.0`.

## Hot-Path Diagnosis

The Start Sharing path had a narrow duplicate local-file read after save:

1. `MarkLabAppModel.startSharingAndConnectThrowing()` calls `saveFile()`.
2. `NativeHostedShareController.startSharing(fileURL:)` reopens the local file to produce import Markdown.
3. `MarkLabAppModel.startSharingAndConnectThrowing()` reopened the local file again to produce the binding/projection baseline.

The duplicate read is not expected to dominate small files, but it is directly on the user-visible Start Sharing path and grows with larger Markdown files.

## Targeted Fix Applied

Changed `NativeHostedShareController` to accept caller-provided normalized Markdown, while preserving the existing `startSharing(fileURL:)` behavior.

Changed `MarkLabAppModel.startSharingAndConnectThrowing()` to:

- save first, preserving existing semantics;
- read the saved file once with shared normalization;
- pass that markdown into hosted import;
- reuse the same markdown for binding/projection baseline.

This removes one post-save local-file read from the Start Sharing hot path without changing provider, auth, schema, storage, WebView, or public API behavior.

## Verification So Far

Passed:

- `git diff --check`
- Read-only hosted alpha smoke via `runAlphaSmoke()`
- `node --check scripts/pan5-native-cli-timing.mjs`
- `swiftc -parse` on the edited Swift source/test files
- Swift 6.2.4 focused timing probe: `swift test --package-path apps/marklab-macos ... --filter PAN5StartupPerformanceProbeTests`
- Swift 6.2.4 hosted-share regression suite: `swift test --package-path apps/marklab-macos ... --filter NativeControlPlaneShareTests` reported 6 tests passed.
- Swift 6.2.4 app-model focused suite: `swift test --package-path apps/marklab-macos ... --filter MarkLabAppModelTests` reported 38 tests passed.
- Web bridge/editor tests: `npx -y pnpm@10.0.0 --filter @marklab/collab-web exec vitest run src/editor/native-bridge.test.ts src/App.test.tsx` reported 26 tests passed.
- Web typecheck: `npx -y pnpm@10.0.0 --filter @marklab/collab-web typecheck`
- Swift 6.2.4 native UI strategy suite: `swift test --package-path apps/marklab-macos ... --filter MarkLabNativeUIStrategyTests` reported 21 tests passed.
- Swift 6.2.4 native CLI bridge suite: `swift test --package-path apps/marklab-macos ... --filter NativeCLIShareBridgeTests` reported 13 tests passed.
- Swift 6.2.4 app-model focused suite after CLI readiness wait: `swift test --package-path apps/marklab-macos ... --filter MarkLabAppModelTests` reported 39 tests passed.
- Swift 6.2.4 app-model focused suite after hidden-window and legacy readiness fallback fixes: `/Users/pan/Library/Developer/Toolchains/swift-6.2.4-RELEASE.xctoolchain/usr/bin/swift test --package-path apps/marklab-macos --filter MarkLabAppModelTests` reported 41 tests passed.
- Swift 6.2.4 PAN-5 timing probe after CLI readiness wait: `swift test --package-path apps/marklab-macos ... --filter PAN5StartupPerformanceProbeTests` passed and emitted Start Sharing plus links median 16.67 ms and already-shared reopen median 8.10 ms for the local proxy.
- Script compatibility smoke after CLI readiness wait: `MARKLAB_APP_PATH=/tmp/MarkLab-pan5-current.app PAN5_SAMPLE_COUNT=1 node scripts/pan5-native-cli-timing.mjs` passed in default local mock response-only mode.
- Rebuilt current-source app after CLI readiness wait: `MARKLAB_APP_VERSION=0.0.0-pan5-local MARKLAB_APP_BUILD=3 node apps/marklab-macos/scripts/package-app.mjs --skip-editor-build --output /tmp/MarkLab-pan5-current.app` passed with the Swift 6.2.4 toolchain.
- `/tmp` package verification after rebuild: `node apps/marklab-macos/scripts/verify-packaged-app.mjs /tmp/MarkLab-pan5-current.app` passed; ad-hoc signed, Sparkle linked, updates not configured, not distribution-ready.
- Wait-enabled packaged-app smoke against local mock: `MARKLAB_APP_PATH=/tmp/MarkLab-pan5-current.app PAN5_SAMPLE_COUNT=1 PAN5_WAIT_FOR_WEBVIEW_READY=1 PAN5_WEBVIEW_READY_TIMEOUT_MS=1 node scripts/pan5-native-cli-timing.mjs` passed and returned expected readiness timeouts with response fields. This proves the packaged app consumes the opt-in wait path, not that the live WebView/provider is ready.
- Swift 6.2.4 current-source package build to `/tmp/MarkLab-pan5-current.app` with `MARKLAB_APP_BUILD=5`
- `node apps/marklab-macos/scripts/verify-packaged-app.mjs /tmp/MarkLab-pan5-current.app`
- `MARKLAB_APP_PATH=/tmp/MarkLab-pan5-current.app PAN5_SAMPLE_COUNT=5 node scripts/pan5-native-cli-timing.mjs`
- Owner Google sign-in/account restoration; stored account now exists under app support and private timing env exists at `/tmp/marklab-pan5-live-env.sh` with mode `0600`.
- Live hosted/WebView one-sample preflight: `PAN5_USE_LIVE_HOSTED=1 PAN5_WAIT_FOR_WEBVIEW_READY=1 PAN5_KEEP_TIMING_TEMP=1 MARKLAB_APP_PATH=/tmp/MarkLab-pan5-current.app PAN5_SAMPLE_COUNT=1 node scripts/pan5-native-cli-timing.mjs` passed.
- Live hosted/WebView final timing: `PAN5_USE_LIVE_HOSTED=1 PAN5_WAIT_FOR_WEBVIEW_READY=1 PAN5_KEEP_TIMING_TEMP=1 MARKLAB_APP_PATH=/tmp/MarkLab-pan5-current.app PAN5_SAMPLE_COUNT=5 node scripts/pan5-native-cli-timing.mjs` passed with no readiness timeouts.

Blocked:

- Default `swift test --package-path apps/marklab-macos ...` while `xcode-select` points at `/Library/Developer/CommandLineTools`.
- Fly deploy from this shell; `/opt/homebrew/bin/flyctl` was installed, but no Fly access token is available. Deploy was not needed for PAN-5 because the native fallback can measure the currently deployed hosted bundle.

Blocked reason: default Command Line Tools SwiftPM manifest-link failure, before code compilation; Fly CLI deploy auth is absent.

## Follow-Up Evidence

1. Repair the default Command Line Tools SwiftPM or keep using the Swift 6.2.4 absolute-path workaround for local native verification.
2. Deploy the web bundle before broader pilot rollout if the team wants the explicit `editor-ready` event in hosted alpha instead of relying on the native legacy bridge fallback.
3. Decide whether the measured live medians are acceptable for Gate 9 small external pilot entry.
