# Prompt — paste this into ChatGPT after uploading both files

---

I've uploaded two files:
1. `marklab-source.zip` — Swift macOS app source code (50 source files)
2. `prd.md` — task brief explaining the bug and what to fix

Please:

1. Extract and read the ZIP. Key files:
   - `apps/marklab-macos/Sources/MarkLabApp/MarkEditShell/MarkEditLocalMarkdownEditorView.swift` (primary fix)
   - `apps/marklab-macos/scripts/verify-packaged-app.mjs` (secondary fix)
   - `apps/marklab-macos/Tests/MarkLabMacOSTests/MarkLabAppModelTests.swift` (check logic correctness)

2. Read `prd.md` in full. It explains the root cause (a Swift array literal eagerly evaluates
   `Bundle.module`, which calls `fatalError` in packaged apps) and what to fix.

3. Implement both fixes. Note: you cannot compile Swift or build the app here — that is expected.
   Write the corrected source code and I will build and verify it on a Mac with Xcode.

4. Produce a downloadable ZIP named `marklab-pan11-fix.zip` containing only changed files:
   ```
   apps/marklab-macos/Sources/MarkLabApp/MarkEditShell/MarkEditLocalMarkdownEditorView.swift
   apps/marklab-macos/scripts/verify-packaged-app.mjs
   CHANGES.md
   ```

5. Output every changed file in full — no ellipsis, no "rest unchanged" placeholders.
