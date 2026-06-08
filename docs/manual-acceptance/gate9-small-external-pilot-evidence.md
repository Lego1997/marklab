# Gate 9 Small External Pilot Evidence

Date opened: 2026-05-31

Linear issue: `PAN-7` Plan and run Gate 9 small external pilot

Source checklist: `docs/manual-acceptance/pre-pilot-launch-checklist-progress-log.md` on `upstream/main`

Upstream commit inspected: `7bba036f5d0a84e6140286fcd00df8f217d70dc4`

Operator: Codex

## Current Status

Gate 9 is blocked before external pilot execution because the accepted pilot artifact now has a launch-smoke blocker. The artifact blocker was previously closed on 2026-05-31, but was reopened on 2026-06-05 after a PAN-12 simulated real-user rehearsal proved the clean zip crashes before UI launch.

Last reconciled on 2026-06-06 CST after Pan approved closing PAN-12 by agent simulation. Live Linear now shows `PAN-7` In Progress, `PAN-11` reopened as urgent Todo, and `PAN-12` Done.

Known completed prerequisites:

- Gates 0-8, including Gate 2.5, are passed for the controlled small pilot.
- `PAN-5` targeted shared-file startup performance pass is Done.
- `PAN-6` collaborator/project-member setup is Done.
- Linear milestone `Pilot entry readiness` is 100 percent complete.

Current blockers before inviting users:

- The previously accepted clean Gate 9 artifact crashes before UI launch (`PAN-11` reopened).
- `PAN-12` is closed by agent simulation; live pilot-user roster/logistics are no longer a current PAN-12 blocker.
- The old clean Gate 9 artifact exists and matches its SHA, but must not be assigned because launch smoke fails.

PAN-12 simulated real-user rehearsal and artifact recheck, 2026-06-05 15:12 CST:

- Subagents ran a bounded simulation/audit with no invite, access link, Start Sharing action, login, private-contact recording, or credential-bearing update.
- Hosted alpha `/healthz` returned `ok: true`, database/schema/provider/store ready.
- `dist/MarkLab-gate9-clean-7bba036-20260531.zip` still matches SHA-256 `19930d40a773fbc047db083df28527e473e5b7d13f1f49a351f77a36f0c490de`.
- Extracting and directly launching the clean app crashes before UI with `MarkLabApp/resource_bundle_accessor.swift:12: Fatal error: could not load resource bundle`.
- User-visible Problem Reporter confirmed the same stack through `static NSBundle.module`, `MarkEditLocalEditorResources.rootURL()`, and `MarkEditLocalMarkdownEditorView.makeNSView(...)`.
- Cause: the local editor resource resolver builds candidates eagerly and evaluates SwiftPM `Bundle.module`, which looks for `MarkLabMacOS_MarkLabApp.bundle` at the app root/original build path, before using the packaged `Contents/Resources/MarkLabMacOS_MarkLabApp.bundle`.
- Patch proof in detached clean worktree `/tmp/marklab-pan12-artifact-fix`: resource lookup now prefers packaged `Bundle.main.resourceURL` before touching `Bundle.module`; focused Swift test passed; packaged app verifier now includes launch smoke; patched package returned `launchSmokePassed: true`.
- Negative check: the old clean zip fails the patched verifier launch smoke.
- Linear sync: reopened `PAN-11` as urgent Todo; added Linear comments `ae9a8c4e-718a-4fd4-8e2c-3c13cdcd81fc` (`PAN-11`), `69c771ea-24f3-4e70-baa3-13c8b808a657` (`PAN-7`), and `4b5f2c92-186b-4144-b881-0f465a7ad4fa` (`PAN-12`); appended `PAN-11` and `PAN-12` as blockers of `PAN-7`.
- Superseded on 2026-06-06: Pan approved closing PAN-12 by agent simulation. PAN-11 remains a technical pre-invite blocker until a clean committed rebuild passes launch smoke.

PAN-12 closure policy change, 2026-06-06 CST:

- Pan approved the completed bounded agent simulation as sufficient PAN-12 closure evidence.
- Linear `PAN-12` was retitled `Close Gate 9 roster/logistics by agent simulation`, rewritten with simulation-based acceptance criteria, and marked Done.
- Linear decision comment: `785426c7-9a8a-4d1e-82e6-b2c66e2d9009`.
- Linear `PAN-7` comment: `ef66bf98-aac2-454d-8b0d-e6cf44626238`.
- `PAN-12` was removed from `PAN-7` blockers; `PAN-11` remains the current pre-invite blocker.
- No invite, access link, Start Sharing action, private-contact recording, or credential-bearing update was performed.

Focused `PAN-12` audit, 2026-05-31 15:52 CST:

- Linear project `MarkLab Pre-Pilot Launch` was checked at session start as the current progress source.
- Linear `PAN-12` is still `Todo`; it has no comments and no confirmed roster/logistics data.
- At this checkpoint, Linear `PAN-7` was `In Progress` with `PAN-12` as the then-known blocker.
- At this checkpoint, Linear `PAN-11` was `Done` and the clean artifact was considered accepted for controlled-pilot assignment. This was superseded by the 2026-06-05 launch-smoke failure above.
- Local goal/evidence search found no confirmed 3-10 pilot roster. Yumin/project membership remains a candidate signal only and is not treated as confirmed pilot-user participation.
- No external invite, cloud access link, Start Sharing action, or credential-bearing update was performed.

Focused `PAN-12` Linear sync, 2026-05-31 15:55 CST:

- Added Linear `PAN-12` blocker comment `adf71180-91cb-4354-ad23-cdb844a013b5`.
- Added Linear `PAN-11` clean artifact comment `00efcde4-e40e-4513-bd9d-2cf0c100e9ac` and moved `PAN-11` to Done.
- Added Linear `PAN-7` blocker-split comment `c83084d3-ed81-494e-8c9e-455bf008841c`.
- Linear `PAN-7` relation check now shows only `PAN-12` in `blockedBy`.
- Result: parent Gate 9 can now distinguish artifact readiness from the remaining human roster/logistics blocker.

Focused `PAN-12` recheck, 2026-05-31 22:41 CST:

- Linear project `MarkLab Pre-Pilot Launch`, `PAN-12`, parent `PAN-7`, and completed artifact issue `PAN-11` were rechecked through the Linear connector.
- At this checkpoint, `PAN-11` was still Done and the clean artifact was still considered the accepted controlled-pilot assignment candidate. This was superseded by the 2026-06-05 launch-smoke failure above.
- `PAN-12` remains Todo with no confirmed roster/logistics data beyond the earlier blocker comments.
- Local roster/evidence search still found no confirmed 3-10 pilot users or privacy-safe aliases, contact paths, roles, macOS versions, login/account readiness, support contact, known-limitations delivery, or non-secret workspace/account alias.
- No external invite, cloud access link, Start Sharing action, or credential-bearing update was performed.

Parent reconciliation, 2026-06-03 22:42 CST:

- Read back completed focused background threads:
  - `019e7d01-d3b6-7820-b5e0-5a2a7e55069d` for `PAN-11`.
  - `019e7d01-414b-78b1-ba1a-d91efa079cc6` for `PAN-12`.
- Linear project `MarkLab Pre-Pilot Launch` shows Gate 9 milestone progress at 42 percent.
- At this checkpoint, Linear `PAN-11` was Done and did not appear in `PAN-7.blockedBy`.
- At this checkpoint, Linear `PAN-7` was In Progress with `PAN-12` as the only then-known blocker.
- Linear `PAN-12` is Todo and still lacks confirmed roster/logistics input.
- Added parent Linear `PAN-7` reconciliation comment `d0e18691-397f-497b-80cd-4317bb96b86f`.
- No external invite, cloud access link, Start Sharing action, or credential-bearing update was performed.

Continuation recheck, 2026-06-04 03:13 CST:

- Linear project `MarkLab Pre-Pilot Launch` still shows Gate 9 milestone progress at 42 percent.
- Linear `PAN-12` is still Todo; its latest existing comment before this continuation was the 2026-05-31 resumed-goal blocker comment `7393c360-7c73-4b29-9116-746df0f754a8`.
- Linear `PAN-7` was still In Progress with `PAN-12` as the only then-known blocker.
- No confirmed pilot roster/logistics input was found in local goal/evidence files or Linear.
- Added Linear `PAN-12` continuation blocker comment `69416f98-7f92-4b42-9530-7eea12b5cb5a`.
- No external invite, cloud access link, Start Sharing action, or credential-bearing update was performed.

## Non-Secret Logistics From Existing Docs

Target stack:

- Hosted origin under test: `https://marklab-relay-alpha.fly.dev`
- Browser collaborator route: `/collab?docId=...&branchId=...&mode=edit|view`
- Provider route shape: `/d/<providerDocId>/ws/<providerDocId>`
- Native app: `MarkLab.app`

Controlled-pilot install position:

- Distribution is ad-hoc for the small controlled pilot.
- No-warning public/non-technical distribution is not claimed.
- The documented scoped workaround is:

```sh
xattr -dr com.apple.quarantine /Applications/MarkLab.app
open /Applications/MarkLab.app
```

Current artifact rule from Gate 5 evidence:

```sh
npx -y pnpm@10.0.0 --filter @marklab/marklab-macos package:app
npx -y pnpm@10.0.0 --filter @marklab/marklab-macos verify:package
ditto -c -k --sequesterRsrc --keepParent dist/MarkLab.app dist/MarkLab-<sha>-controlled-pilot.zip
```

Known limitations to tell pilot users:

- Controlled pilot uses an explicit per-app Gatekeeper workaround.
- Auto-update is not advertised for ordinary pilot builds.
- Signed/notarized public distribution remains Gate 10.5.
- Paid billing remains deferred.
- P2-002 active-editor remote-cursor re-anchor latency is an accepted visual limitation for the small pilot unless real pilot confusion makes it blocking.

## Readiness Checklist

- [ ] Pick 3-10 named external pilot users.
- [ ] Record each user's macOS version.
- [ ] Record each user's install artifact and delivery path.
- [ ] Record each user's login/account path.
- [ ] Record support contact sent to each user.
- [ ] Record known limitations sent to each user.
- [x] Confirm hosted `/healthz` before inviting users.
- [ ] Confirm replacement artifact package verification and launch smoke after PAN-11 rebuild.
- [ ] Confirm owner/app sign-in path before inviting users.

Required fields before the first invite:

| Field | Status | Notes |
| --- | --- | --- |
| Pilot users | Missing | Need 3-10 named external users or privacy-safe aliases with contact paths. |
| macOS versions | Missing | Minimum supported app platform from current app metadata is macOS 14. |
| Exact artifact | Blocked | `dist/MarkLab-gate9-clean-7bba036-20260531.zip` matches its SHA but crashes before UI launch; rebuild after PAN-11 fix. |
| Package verification | Blocked | Old `verify:package` passed but lacked launch smoke. Replacement artifact must pass structure/codesign and packaged launch smoke. |
| Login/account path | Missing | Record OIDC/account readiness without storing secrets. |
| Pilot workspace/account alias | Missing | Record a non-secret alias only. |
| Support contact | Missing | Needed before sending users the pilot packet. |
| Known limitations sent | Missing | Use the limitations listed below unless superseded. |

Historical `PAN-12` blocker table, 2026-05-31 15:52 CST:

| Required Field | Current Evidence | Status | Smallest Unblock Action |
| --- | --- | --- | --- |
| 3-10 users or aliases | `PILOT_ROSTER.md` has only `TBD` rows. | Missing | Provide at least 3 confirmed pilot users or privacy-safe aliases. |
| Contact path | No per-user contact path recorded. | Missing | Provide a contact path per pilot user. |
| Role | No per-user roles recorded. | Missing | Assign owner/collaborator/reviewer roles. |
| macOS version | No per-user macOS versions recorded. | Missing | Confirm macOS version per user, with macOS 14+ expected from app metadata. |
| Artifact/delivery assignment | Previous clean artifact suspended. | Missing | Rebuild and accept a launch-smoke-passing artifact, then assign it and a delivery path per user. |
| Login/account path | No non-secret account/login path recorded. | Missing | Record login/account readiness without secrets. |
| Support contact | `support_contact: TBD`. | Missing | Approve support contact text/path for pilot packet. |
| Known limitations delivery | Not sent to any user. | Missing | Send or approve the known-limitations packet before invites. |
| Workspace/account alias | `pilot_workspace: TBD`. | Missing | Record a non-secret workspace/account alias. |

Linear blocker issues:

- `PAN-11` Accept or rebuild the Gate 9 pilot artifact. Reopened as urgent Todo on 2026-06-05 after clean-artifact launch crash.
- `PAN-12` Close Gate 9 roster/logistics by agent simulation. Closed on 2026-06-06 after Pan accepted the bounded agent simulation as sufficient PAN-12 evidence. Live roster/logistics remain execution inputs for any future invite, but they are no longer a current PAN-12 blocker.

Toolchain blocker detail:

- Local `swift package describe` fails even for a minimal throwaway package, so the failure is not specific to MarkLab's `Package.swift`.
- Minimal packages with `swift-tools-version: 6.0` and `swift-tools-version: 5.9` both fail manifest linking with `PackageDescription.Package.__allocating_init(...)`.
- Current `swift --version`: Apple Swift `6.3.2`, target `arm64-apple-macosx26.0`.
- Current developer directory: `/Library/Developer/CommandLineTools`.
- Installed CLTools executables package: `26.5.0.0.1777544298`.
- `/Applications/Xcode.appdownload` exists, but it is only an App Store placeholder bundle containing `Contents/placeholderInfo` for `com.apple.dt.Xcode`; no usable `/Applications/Xcode.app` is installed.
- `xcodebuild -version` still fails because the active developer directory is Command Line Tools, not full Xcode.
- Resolved later on 2026-05-31 14:45 CST: `/Applications/Xcode.app` became available. `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -version` returned Xcode `26.5`, build `17F42`; SwiftPM manifest loading succeeded under that `DEVELOPER_DIR`.

Hosted health evidence, 2026-05-31:

```json
{
  "ok": true,
  "schema": {
    "ready": true,
    "missing": []
  },
  "provider": {
    "ready": true,
    "storeReady": true,
    "mode": "process"
  },
  "database": {
    "ready": true
  }
}
```

Pre-invite automated baseline, 2026-05-31:

- `npx -y pnpm@10.0.0 typecheck` passed from a temporary `upstream/main` worktree.
- `npx -y pnpm@10.0.0 test` passed from the same temporary worktree: 66 test files passed, 530 tests passed, 1 file skipped, 1 test skipped.
- `npx -y pnpm@10.0.0 --filter @marklab/marklab-macos package:app` did not complete in this environment. The local editor bundle built, then Swift Package Manager failed before app compilation with an invalid-manifest link error under `/Library/Developer/CommandLineTools`:

```text
Undefined symbols for architecture arm64:
  "PackageDescription.Package.__allocating_init(...)"
```

This is recorded as a local toolchain/build blocker, not as a product runtime failure.

- The existing ignored local `dist/MarkLab.app` is not accepted as the Gate 9 artifact. Running the upstream verifier against it failed because `Contents/Frameworks/Sparkle.framework` is missing.
- The local Swift Package Manager problem is system-wide on this machine: a minimal temporary Swift package with `swift-tools-version: 6.0` and another with `swift-tools-version: 5.9` both failed to load their manifests with the same `PackageDescription.Package.__allocating_init(...)` link error.

Candidate artifact, 2026-05-31:

- Candidate zip: `dist/MarkLab-gate9-candidate-7bba036-20260531.zip`
- SHA-256: `a33c9a4100553bed6dd3840dba2852baf39d90b7964e54b5d4287bc5536f52c0`
- Size: `4.2M`
- Source worktree: sibling `marklab-pan-5-pilot-entry` worktree.
- Source HEAD: `7bba036f5d0a84e6140286fcd00df8f217d70dc4`
- Source state caveat: worktree has uncommitted PAN-5 changes; diff hash is `3a49cb6b52562fd3347812a9e62d9542917843f4fc248e3303b56a42c31b73e1`.
- App version/build: `0.0.0-alpha` / `1`
- Minimum macOS: `14.0`
- Verification: extracted zip passes `verify-packaged-app`.
- Signing/distribution: ad-hoc, not Developer ID signed, not notarized, Gatekeeper rejected. This matches the controlled-pilot limitation but is not public distribution ready.
- Sparkle: framework linked; updates not configured.
- UI smoke: Computer Use opened `/tmp/marklab-gate9-ui-smoke.md` through the candidate app's Open panel, and the Markdown content rendered in the MarkEdit shell.

Candidate acceptance caveat: this candidate should not be sent to pilot users until the owner accepts the dirty PAN-5 source state or a clean rebuild is produced from a committed source state.

Clean artifact, 2026-05-31 14:45 CST:

- Clean zip: `dist/MarkLab-gate9-clean-7bba036-20260531.zip`
- SHA-256: `19930d40a773fbc047db083df28527e473e5b7d13f1f49a351f77a36f0c490de`
- Size: `4.2M`
- Source worktree: `/tmp/marklab-gate9-xcode.YLt0BF`
- Source HEAD: `7bba036f5d0a84e6140286fcd00df8f217d70dc4`
- Source state: clean detached `upstream/main` worktree.
- Toolchain: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`; Xcode `26.5` build `17F42`.
- App version/build: `0.0.0-alpha` / `1`
- Minimum macOS: `14.0`
- Build verification:
  - `npx -y pnpm@10.0.0 install --frozen-lockfile` passed in the clean worktree.
  - `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npx -y pnpm@10.0.0 --filter @marklab/marklab-macos package:app` passed.
  - `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npx -y pnpm@10.0.0 --filter @marklab/marklab-macos verify:package` passed.
  - The zipped artifact was extracted to `/tmp/marklab-gate9-clean-verify.eTzjfy`, and `verify-packaged-app.mjs` passed against the extracted `MarkLab.app`.
- Signing/distribution: ad-hoc, not Developer ID signed, not notarized, Gatekeeper rejected. This remains acceptable only for the controlled pilot with the documented per-app workaround; it is not public distribution ready.
- Sparkle: framework linked; updates not configured.

Resumed toolchain check, 2026-05-31 13:04 CST:

- The user reported Xcode is installed, so the toolchain was rechecked before attempting another clean build.
- `/Applications` contains `Xcode.appdownload`, not `Xcode.app`.
- `plutil -p /Applications/Xcode.appdownload/Contents/placeholderInfo` identifies the placeholder bundle as `com.apple.dt.Xcode`.
- `xcode-select -p` remains `/Library/Developer/CommandLineTools`.
- `xcrun --find swiftc` resolves to `/Library/Developer/CommandLineTools/usr/bin/swiftc`.
- `xcodebuild -version` reports that the tool requires Xcode but the active developer directory is Command Line Tools.
- A throwaway `swift package init --type executable` succeeded, but `swift package describe --type json` failed before useful package work with an invalid manifest generated against the mismatched SwiftPM/PackageDescription surface (`swiftLanguageModes` / `.v6` not accepted).
- Result at that time: `PAN-11` remained unresolved. There was still no clean Gate 9 rebuild from committed source on this machine.

Superseded by the 2026-05-31 14:45 CST clean artifact rebuild above. `PAN-11` was closed in Linear on 2026-05-31 after comment `853c03e2-0696-452e-9389-1f2aad0e819b`; at that point, `PAN-7` was considered blocked by `PAN-12`. This was later superseded by the 2026-06-05 artifact crash finding.

Linear/Chrome progress check, 2026-05-31 13:04 CST:

- The Linear connector failed three times during MCP startup with a `https://chatgpt.com/backend-api/wham/apps` request failure, so connector writes were not available in this resumed pass.
- Read-only Chrome fallback loaded the logged-in Linear `PAN-12` tab.
- At this checkpoint, `PAN-12` was still `Todo` and still required 3-10 users, contact path, role, macOS version, artifact/delivery assignment, login/account path, support contact, known-limitations delivery, and a non-secret pilot workspace/account alias.
- No external pilot invite or sharing action was started.

Linear/Chrome progress check, 2026-05-31 14:56 CST:

- Linear connector startup still fails with the same app handshake/request failure, so read/write connector sync remains unavailable.
- Chrome read-only fallback loaded `PAN-12` directly.
- At this checkpoint, `PAN-12` was still `Todo`, still blocking `PAN-7`, and still listed the same required fields: 3-10 named users or privacy-safe aliases, contact path, role, macOS version, artifact/delivery path, login/account path without secrets, support contact, known limitations sent, and non-secret pilot workspace/account alias.
- `PILOT_ROSTER.md` is still placeholder-only.
- No external pilot invite, Start Sharing action, or cloud access-link creation was performed.

Workspace hygiene:

- `git diff --check` passed in the main goal workspace after evidence edits; the edited evidence files are currently untracked in this checkout.
- `rg -n '[[:blank:]]$' .codex/goals/gate9-small-external-pilot docs/manual-acceptance/gate9-small-external-pilot-evidence.md docs/manual-acceptance/pre-pilot-launch-checklist-progress-log.md` found no trailing whitespace.
- `git diff --check` passed in the temporary `upstream/main` worktree after automated checks.

## Pilot Success Metrics

For each user:

- [ ] Install success.
- [ ] First local Markdown file open.
- [ ] First share link created.
- [ ] First browser collaborator join.
- [ ] Local file receives collaborator update.
- [ ] No data-loss incident.
- [ ] Support time recorded.

Gate-level criteria:

- [ ] At least 3 real users complete the core flow.
- [ ] No unresolved P0 remains.
- [ ] Every blocking bug is recorded in `bug.md` or a linked Linear issue.
- [ ] Usage/cost notes are recorded for the Gate 4 follow-up.
- [ ] Expansion decision is written: stay at 3-10, expand to 10-50, or stop/fix first.

## Pilot User Runs

| User | Contact | Role | macOS | Artifact | Login Path | Install | Sign-In | Local File Open | Start Sharing | Edit Link | Browser Join | Local File Update | No Data Loss | Support Time | Bugs/Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | TBD | not_started | not_started | not_started | not_started | not_started | not_started | not_started | unverified | TBD | Awaiting named pilot user. |
| TBD | TBD | TBD | TBD | TBD | TBD | not_started | not_started | not_started | not_started | not_started | not_started | not_started | unverified | TBD | Awaiting named pilot user. |
| TBD | TBD | TBD | TBD | TBD | TBD | not_started | not_started | not_started | not_started | not_started | not_started | not_started | unverified | TBD | Awaiting named pilot user. |

## Bugs And Support Notes

No Gate 9 pilot-user bugs have been observed yet because external pilot execution has not started. The current readiness blocker is the reopened `PAN-11` artifact launch crash. `PAN-12` is closed by agent simulation; live roster/logistics remain future pilot execution inputs, not a current PAN-12 blocker.

## Usage And Cost Notes

No Gate 9 pilot usage/cost data has been collected yet because external pilot execution has not started.

Fields to collect after each user run:

- workspace/account alias
- number of shared docs touched
- guest collaborator sessions
- approximate session duration
- support minutes
- any notable Fly/Neon/provider observations
- whether cost/usage remains within Gate 4 small-pilot guardrails

## Expansion Decision

Stop/fix first. Do not expand to 10-50 users. Do not invite the first 3-10 users until `PAN-11` is resolved and action-time approval is given for any real invite/access-link work.

Blocked decision, 2026-05-31:

- Users completed: `0`.
- Core-flow status: not started for external users.
- P0/P1 status: no Gate 9 pilot-user P0/P1 can be observed because no pilot run started; prior Gates 0-8 remain passed.
- Usage/cost status: no Gate 9 usage/cost evidence exists because no pilot run started.
- Current blocking issue:
  - `PAN-11`: clean artifact accepted earlier, but now suspended because extracted app crashes before UI launch.
- Closed issue:
  - `PAN-12`: closed by agent simulation on 2026-06-06; roster/logistics are no longer a PAN-12 blocker.
- Smallest unblock action: land/rebuild the PAN-11 artifact fix, then collect/approve the pilot roster and support/contact/login logistics before any real invite.

## Linear Sync

- 2026-05-31: `PAN-7` moved to In Progress after the user asked to proceed with the Gate 9 goal.
- 2026-05-31: Added a Linear progress comment noting the run sheet, hosted health pass, and remaining pilot-logistics blocker.
- 2026-05-31: Candidate artifact verification and UI-smoke evidence recorded; final invite still waits on pilot users, support contact, workspace/login path, and artifact source-state acceptance.
- 2026-05-31: Added Linear progress comment `1361be45-8453-4a4d-a374-103414ff6914` with candidate artifact details and remaining blockers.
- 2026-05-31: Created blocker child issues `PAN-11` and `PAN-12` under `PAN-7`.
- 2026-05-31: Added Linear `PAN-11` comment `39e2cc59-3d05-4e58-a836-d11bb8ebda42` with system-wide SwiftPM toolchain diagnosis.
- 2026-05-31: Moved `PAN-11` and `PAN-12` from Backlog to Todo.
- 2026-05-31: Gate 9 recorded as blocked before external pilot execution. `PAN-7` is blocked by `PAN-11` and `PAN-12`.
- 2026-05-31: Added Linear `PAN-7` blocker audit comment `50cbf4a7-0c2b-4956-9d1d-f96f853295af`.
- 2026-05-31 13:04 CST: Linear connector startup failed three times; read-only Chrome fallback confirmed `PAN-12` remains Todo with the same missing roster/logistics fields. No Linear write was made in this resumed pass.
- 2026-05-31 14:45 CST: Clean Gate 9 artifact produced and verified from `upstream/main`; `PAN-11` is ready to mark Done.
- 2026-05-31 14:45 CST: Attempted to add the clean-artifact comment to Linear `PAN-11` twice through the Linear connector. Both attempts timed out in the automatic permission approval review, so no new Linear write is confirmed from this pass.
- 2026-05-31 14:56 CST: Linear connector startup still failed; Chrome read-only fallback confirmed `PAN-12` remains Todo/blocking with no roster/logistics data. This is the third consecutive resumed-goal pass where the same missing human roster/logistics condition blocks external execution.
- 2026-05-31 15:52 CST: Linear connector reads succeeded. `PAN-12` remained Todo with no comments and no roster/logistics data; the repo recorded a focused `PAN-12` no-roster blocker table.
- 2026-05-31 15:55 CST: Added Linear `PAN-12` blocker comment `adf71180-91cb-4354-ad23-cdb844a013b5`. Added parent `PAN-7` blocker-split comment `c83084d3-ed81-494e-8c9e-455bf008841c`. Synced clean artifact to `PAN-11`, comment `00efcde4-e40e-4513-bd9d-2cf0c100e9ac`, and moved `PAN-11` to Done.
- 2026-05-31 22:43 CST: Added Linear `PAN-12` resumed-goal blocker comment `7393c360-7c73-4b29-9116-746df0f754a8`. `PAN-12` remains Todo because no confirmed roster/logistics input was found.
- 2026-06-03 22:45 CST: Parent reconciliation after both focused background threads completed. Live Linear readback confirmed `PAN-11` Done, `PAN-7` blocked only by `PAN-12`, and `PAN-12` Todo with no roster/logistics input. Added parent `PAN-7` comment `d0e18691-397f-497b-80cd-4317bb96b86f`.
- 2026-06-05 15:12 CST: PAN-12 simulated real-user rehearsal found the clean Gate 9 artifact crashes before UI launch. Reopened `PAN-11` as urgent Todo, updated `PAN-7` blockers to include `PAN-11` and `PAN-12`, and added Linear comments `ae9a8c4e-718a-4fd4-8e2c-3c13cdcd81fc`, `69c771ea-24f3-4e70-baa3-13c8b808a657`, and `4b5f2c92-186b-4144-b881-0f465a7ad4fa`.
- 2026-06-06: Pan approved closing `PAN-12` by agent simulation. Linear `PAN-12` is Done, `PAN-7` has comment `ef66bf98-aac2-454d-8b0d-e6cf44626238` recording that PAN-12 is no longer a blocker, and `PAN-11` remains the current pre-invite blocker.

## Pre-Invite Pilot Packet Template

Use this as a draft only. Fill the placeholders and keep secrets out of this file.

```md
Subject: MarkLab controlled pilot install and first-flow check

Hi <pilot user>,

Thanks for helping test MarkLab. This is a small controlled pilot, not a public release.

What you will receive:

- App artifact: <artifact name and delivery path>
- Target: https://marklab-relay-alpha.fly.dev
- Support contact: <support contact>

Known limitations:

- This build is ad-hoc signed, so it requires a scoped per-app Gatekeeper workaround.
- Do not disable Gatekeeper globally.
- Auto-update is not enabled for this ordinary pilot build.
- Public signed/notarized distribution and paid billing are not part of this pilot.
- Remote cursor re-anchor can visually lag in the actively editing surface, but this should not affect document convergence.

First-flow checklist:

1. Install/open MarkLab.
2. Sign in using the provided account path.
3. Open a local Markdown file.
4. Click Start Sharing.
5. Create an edit link.
6. Have a browser collaborator join.
7. Confirm the local file receives collaborator edits.
8. Send support time and any bugs to <support contact>.
```
