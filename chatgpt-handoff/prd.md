# MarkLab macOS — Task Brief for ChatGPT

## What this project is

**MarkLab** is a local-first Markdown collaboration app for macOS. A plain `.md` file on disk is
the canonical document. A native Swift macOS app wraps a MarkEdit-based CodeMirror editor and
adds real-time collaboration via a Y-Sweet (Yjs) CRDT relay. Browser collaborators join via a
share link; all edits converge to the local `.md` file on disk.

## What you can and cannot do here

**You can:** read, reason about, and rewrite Swift source files and Node.js scripts.

**You cannot:** compile Swift, build `MarkLab.app`, run `swift test`, or launch the packaged app.
There is no Xcode in this environment. Your job is to produce the correct source code. The
developer will apply your output, build with Xcode on a Mac, and verify locally.

---

## The task: fix PAN-11 — packaged app crash before UI launch

### Files in the ZIP

```
apps/marklab-macos/
  Package.swift                                         Swift Package manifest
  Sources/MarkLabApp/
    MarkEditShell/
      MarkEditLocalMarkdownEditorView.swift             ← PRIMARY FILE TO FIX
    Resources/MarkEditLocalEditor/                      Bundled editor HTML + JS
  Sources/MarkLabMacOS/                                 Library target (shared native logic)
  Tests/MarkLabMacOSTests/                              Swift tests
  scripts/
    package-app.mjs                                     Packages MarkLab.app from SwiftPM build
    verify-packaged-app.mjs                             ← ALSO NEEDS A FIX
docs/goals/spec.md                                      Project context and current status
```

### Symptom

`MarkLab.app`, after being packaged with `scripts/package-app.mjs` and launched on macOS, crashes
immediately before any UI appears. The crash originates in the auto-generated (not in the repo)
SwiftPM file `MarkLabApp/resource_bundle_accessor.swift:12`.

### Root cause (read carefully)

In `MarkEditLocalMarkdownEditorView.swift`, the private `MarkEditLocalEditorResources.rootURL()`
method currently reads:

```swift
static func rootURL() throws -> URL {
  let fileManager = FileManager.default
  let candidates = [
    Bundle.main.resourceURL?.appending(path: resourceBundleName, directoryHint: .isDirectory),
    Bundle.main.bundleURL.appending(path: resourceBundleName, directoryHint: .isDirectory),
    Bundle.module.resourceURL,   // ← THE BUG
  ].compactMap { $0 }
  if let resourceURL = candidates.first(where: { fileManager.fileExists(atPath: $0.path) }) {
    return resourceURL
  }
  throw MarkEditLocalEditorResourceError.missingRoot
}
```

**The bug:** Swift evaluates every element of an array literal before constructing the array.
`Bundle.module` is a SwiftPM-generated `static let` that calls `fatalError(...)` when it cannot
find the resource bundle at the SwiftPM build path. In a packaged `.app`, that build path no
longer exists (the bundle lives at `Contents/Resources/MarkLabMacOS_MarkLabApp.bundle`), so
`Bundle.module` crashes with a fatal error — before the first candidate (`Bundle.main.resourceURL`)
is ever checked.

The resource bundle IS correctly placed by the packager. `Bundle.main.resourceURL` would have
found it. But evaluation never reaches that check because the array literal triggers `Bundle.module`
first.

### Fix 1 — `Sources/MarkLabApp/MarkEditShell/MarkEditLocalMarkdownEditorView.swift`

Replace the array-literal approach in `rootURL()` with sequential if-checks so `Bundle.module` is
only evaluated after the safe paths have been tried and failed:

```swift
static func rootURL() throws -> URL {
  let fileManager = FileManager.default
  // Check packaged-app paths first — avoids triggering Bundle.module eagerly.
  // In a packaged .app, Bundle.module calls fatalError when the SwiftPM build
  // path is absent; Bundle.main.resourceURL correctly points to Contents/Resources/.
  if let url = Bundle.main.resourceURL?
      .appending(path: resourceBundleName, directoryHint: .isDirectory),
     fileManager.fileExists(atPath: url.path) {
    return url
  }
  let bundleURL = Bundle.main.bundleURL
      .appending(path: resourceBundleName, directoryHint: .isDirectory)
  if fileManager.fileExists(atPath: bundleURL.path) {
    return bundleURL
  }
  // Development / swift-test fallback. Only safe in SwiftPM build environments
  // where the bundle exists at the generated path next to the executable.
  if let url = Bundle.module.resourceURL, fileManager.fileExists(atPath: url.path) {
    return url
  }
  throw MarkEditLocalEditorResourceError.missingRoot
}
```

> If you find a way to make the `Bundle.module` fallback unconditionally safe (e.g. using
> `Bundle(for:)` on a private sentinel class defined in the same file) rather than relying on the
> packaged paths returning first, use that instead.

### Fix 2 — `scripts/verify-packaged-app.mjs`

The script checks the resource bundle's contents structurally but does **not** launch the app.
Add a launch-smoke check at the end:

1. Spawn `Contents/MacOS/MarkLabApp` as a child process (use Node.js `child_process.spawn`,
   not `spawnSync`, so you can use a timeout).
2. Wait up to 2 seconds. If the process exits within that window → crash detected.
3. If still alive after 2 seconds → startup succeeded. Kill it with SIGTERM.
4. Add `launchSmokePassed: true/false` to the JSON summary already printed by the script.
5. Exit with code 1 if the smoke fails.

The executable path is already computed near the top of the script:
```js
const executable = resolve(appPath, 'Contents/MacOS/MarkLabApp');
```

---

## Constraints

- Change only the two files above unless strictly necessary.
- Do not add Swift Package dependencies.
- Do not restructure `MarkEditLocalEditorResources` beyond `rootURL()`.
- Check `MarkLabAppModelTests.swift` for any tests that call `bundledEditorContract()` (which
  calls `rootURL()` indirectly) and confirm your fix does not break the logic.

---

## Output

Produce a downloadable ZIP named **`marklab-pan11-fix.zip`** with:

```
marklab-pan11-fix.zip
  apps/marklab-macos/Sources/MarkLabApp/MarkEditShell/MarkEditLocalMarkdownEditorView.swift
  apps/marklab-macos/scripts/verify-packaged-app.mjs
  CHANGES.md
```

`CHANGES.md` should explain: what changed in each file, why, and what the developer should run
to verify (build with Xcode, run `verify:package`, expect `launchSmokePassed: true`).

**Output every changed file in full — no ellipsis, no `// ... rest unchanged`.** The developer
will replace the files wholesale.
