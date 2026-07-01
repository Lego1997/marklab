import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { callMarklabTool } from '../src/tools';
import {
  nativeConflictFileName,
  startExportServer,
  tempDir,
  testEnv,
  writeNativeSharedState,
} from './helpers';

describe('conflict surface', () => {
  it('surfaces injected native conflicts using the exact conflict filename algorithm', async () => {
    const directory = await tempDir('marklab-codex-conflict-');
    const appSupportDir = join(directory, 'app-support');
    const conflictsDir = join(appSupportDir, 'conflicts');
    await mkdir(conflictsDir, { recursive: true });
    const markdownPath = join(directory, 'shared.md');
    await writeFile(markdownPath, '# Local\n', 'utf8');
    const state = await writeNativeSharedState({ appSupportDir, file: markdownPath, markdown: '# Local\n' });
    await writeFile(join(conflictsDir, nativeConflictFileName(state.canonicalPath)), JSON.stringify({
      status: 'open',
      localMarkdown: '# Local\n',
      sharedMarkdown: '# Shared\n',
      baselineMarkdown: '# Base\n',
    }), 'utf8');

    const conflict = await callMarklabTool('marklab_conflict', { file: state.canonicalPath }, {
      env: testEnv({ MARKLAB_APP_SUPPORT_DIR: appSupportDir }),
    });

    expect(conflict).toMatchObject({
      ok: true,
      data: {
        path: state.canonicalPath,
        hasConflict: true,
        syncState: 'conflict',
        nextStep: expect.stringContaining('Resolve the conflict'),
      },
    });
  });

  it('treats provider_unknown as status caution, not as a conflict result', async () => {
    const directory = await tempDir('marklab-codex-provider-unknown-');
    const appSupportDir = join(directory, 'app-support');
    await mkdir(appSupportDir, { recursive: true });
    const markdownPath = join(directory, 'shared.md');
    const markdown = '# Shared\n';
    await writeFile(markdownPath, markdown, 'utf8');
    const state = await writeNativeSharedState({ appSupportDir, file: markdownPath, markdown });
    const exportServer = await startExportServer(new Map(), { authorize: () => false });

    try {
      const status = await callMarklabTool('marklab_status', { file: state.canonicalPath }, {
        env: testEnv({
          MARKLAB_APP_SUPPORT_DIR: appSupportDir,
          MARKLAB_CONTROL_PLANE_API_URL: exportServer.apiUrl,
          MARKLAB_USER_TOKEN: 'ml_user_session',
        }),
      });
      expect(status).toMatchObject({
        ok: true,
        data: {
          syncState: 'provider_unknown',
          caution: expect.stringContaining('provider'),
        },
      });

      const conflict = await callMarklabTool('marklab_conflict', { file: state.canonicalPath }, {
        env: testEnv({
          MARKLAB_APP_SUPPORT_DIR: appSupportDir,
          MARKLAB_CONTROL_PLANE_API_URL: exportServer.apiUrl,
          MARKLAB_USER_TOKEN: 'ml_user_session',
        }),
      });
      expect(conflict).toMatchObject({
        ok: true,
        data: {
          hasConflict: false,
          syncState: 'provider_unknown',
          conflict: null,
        },
      });
    } finally {
      await exportServer.close();
    }
  });
});
