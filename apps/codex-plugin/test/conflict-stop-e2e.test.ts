import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSkillEditAttempt } from '../src/skill-protocol';
import { nativeConflictFileName, repoRoot, tempDir, testEnv, writeNativeSharedState } from './helpers';

describe('conflict-stop skill path', () => {
  it('performs zero representative writes after an injected conflict is visible', async () => {
    const directory = await tempDir('marklab-codex-stop-');
    const appSupportDir = join(directory, 'app-support');
    const conflictsDir = join(appSupportDir, 'conflicts');
    await mkdir(conflictsDir, { recursive: true });
    const markdownPath = join(directory, 'shared.md');
    const original = '# Shared\n';
    await writeFile(markdownPath, original, 'utf8');
    const state = await writeNativeSharedState({ appSupportDir, file: markdownPath, markdown: original });
    await writeFile(join(conflictsDir, nativeConflictFileName(state.canonicalPath)), JSON.stringify({
      status: 'open',
      localMarkdown: original,
      sharedMarkdown: '# Human conflict\n',
      baselineMarkdown: '# Base\n',
    }), 'utf8');

    const writes: string[] = [];
    const result = await runSkillEditAttempt({
      file: state.canonicalPath,
      sentinel: 'Codex representative edit',
      env: testEnv({ MARKLAB_APP_SUPPORT_DIR: appSupportDir }),
      writeText: async (file, text) => {
        writes.push(`${file}:${text}`);
        await writeFile(file, text, 'utf8');
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'conflict_required',
        nextStep: expect.stringContaining('STOP'),
      },
    });
    expect(writes).toEqual([]);
    await expect(readFile(state.canonicalPath, 'utf8')).resolves.toBe(original);

    const skill = await readFile(join(repoRoot, 'apps/codex-plugin/skills/marklab/SKILL.md'), 'utf8');
    expect(skill).toMatch(/STOP/u);
    expect(skill).toMatch(/hasConflict:true|hasConflict: true/u);
    expect(skill).toMatch(/provider_unknown/u);
  });
});
