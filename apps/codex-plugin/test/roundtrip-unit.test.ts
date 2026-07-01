import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { callMarklabTool } from '../src/tools';
import { markdownHash, startExportServer, tempDir, testEnv, writeNativeSharedState } from './helpers';

describe('roundtrip convergence logic', () => {
  it('reports synced only when disk, projection baseline, and provider export hashes match', async () => {
    const directory = await tempDir('marklab-codex-roundtrip-');
    const appSupportDir = join(directory, 'app-support');
    await mkdir(appSupportDir, { recursive: true });
    const markdownPath = join(directory, 'shared.md');
    const markdown = '# Shared\nCodex sentinel\n';
    await writeFile(markdownPath, markdown, 'utf8');
    const state = await writeNativeSharedState({ appSupportDir, file: markdownPath, markdown });
    const exportServer = await startExportServer(new Map([[`${state.docId}:${state.branchId}`, markdown]]));

    try {
      const result = await callMarklabTool('marklab_status', { file: state.canonicalPath }, {
        env: testEnv({
          MARKLAB_APP_SUPPORT_DIR: appSupportDir,
          MARKLAB_CONTROL_PLANE_API_URL: exportServer.apiUrl,
          MARKLAB_USER_TOKEN: 'ml_user_session',
        }),
      });

      expect(result).toMatchObject({
        ok: true,
        data: {
          path: state.canonicalPath,
          shared: true,
          syncState: 'synced',
          observedHash: state.hash,
          providerVerification: {
            status: 'verified',
            exportedHash: state.hash,
          },
        },
      });
    } finally {
      await exportServer.close();
    }
  });

  it('keeps wait_synced pending when the provider export has not caught up', async () => {
    const directory = await tempDir('marklab-codex-roundtrip-pending-');
    const appSupportDir = join(directory, 'app-support');
    await mkdir(appSupportDir, { recursive: true });
    const markdownPath = join(directory, 'shared.md');
    const localMarkdown = '# Shared\nCodex sentinel\n';
    const staleMarkdown = '# Shared\nHuman sentinel only\n';
    await writeFile(markdownPath, localMarkdown, 'utf8');
    const state = await writeNativeSharedState({ appSupportDir, file: markdownPath, markdown: localMarkdown });
    const exportServer = await startExportServer(new Map([[`${state.docId}:${state.branchId}`, staleMarkdown]]));

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
          syncState: 'provider_pending',
          observedHash: markdownHash(localMarkdown),
          providerVerification: {
            status: 'pending',
            exportedHash: markdownHash(staleMarkdown),
          },
        },
      });

      const waited = await callMarklabTool('marklab_wait_synced', { file: state.canonicalPath, timeout_ms: 25 }, {
        env: testEnv({
          MARKLAB_APP_SUPPORT_DIR: appSupportDir,
          MARKLAB_CONTROL_PLANE_API_URL: exportServer.apiUrl,
          MARKLAB_USER_TOKEN: 'ml_user_session',
        }),
      });
      expect(waited).toMatchObject({
        ok: false,
        error: {
          code: 'sync_timeout',
          details: {
            syncState: 'provider_pending',
            observedHash: markdownHash(localMarkdown),
          },
        },
      });
    } finally {
      await exportServer.close();
    }
  });
});
