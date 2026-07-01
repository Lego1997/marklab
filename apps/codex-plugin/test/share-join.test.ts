import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { callMarklabTool } from '../src/tools';
import { tempDir, testEnv, waitForNativeRequest, writeNativeResponse } from './helpers';

describe('share and join tools', () => {
  it('creates edit share requests and redacts tokenized URLs by default', async () => {
    const directory = await tempDir('marklab-codex-share-');
    const appSupportDir = join(directory, 'app-support');
    await mkdir(appSupportDir, { recursive: true });
    const markdownPath = join(directory, 'share.md');
    await writeFile(markdownPath, '# Share\n', 'utf8');

    const promise = callMarklabTool('marklab_share', { file: markdownPath, role: 'edit' }, {
      env: testEnv({
        MARKLAB_APP_SUPPORT_DIR: appSupportDir,
        MARKLAB_NATIVE_CLI_TIMEOUT_MS: '5000',
        MARKLAB_CONTROL_PLANE_API_URL: 'https://api.example.test',
        MARKLAB_PUBLIC_WEB_URL: 'https://app.example.test',
        MARKLAB_USER_TOKEN: 'ml_user_session',
        MARKLAB_WORKSPACE_ID: 'workspace_1',
      }),
    });
    const request = await waitForNativeRequest(appSupportDir);
    expect(request).toMatchObject({ action: 'share', role: 'edit' });
    await writeNativeResponse(appSupportDir, request, {
      ok: true,
      action: 'native_share_link_created',
      file: request.file,
      role: 'edit',
      url: 'https://app.example.test/collab?docId=doc_cli&branchId=branch_main&token=ml_access_edit&mode=edit',
      copied: true,
      docId: 'doc_cli',
      branchId: 'branch_main',
      grantId: 'grant_edit',
      opened: false,
    });

    const result = await promise;
    expect(result).toMatchObject({
      ok: true,
      data: {
        role: 'edit',
        docId: 'doc_cli',
        branchId: 'branch_main',
        grantId: 'grant_edit',
        urlRedacted: true,
      },
    });
    expect(JSON.stringify(result)).toContain('token=REDACTED');
    expect(JSON.stringify(result)).not.toContain('ml_access_edit');
  });

  it('joins edit links into explicit absolute targets through the native request bridge', async () => {
    const directory = await tempDir('marklab-codex-join-');
    const appSupportDir = join(directory, 'app-support');
    await mkdir(appSupportDir, { recursive: true });
    const target = join(directory, 'joined.md');
    const link = 'https://app.example.test/collab?docId=doc_join&branchId=branch_main&token=ml_access_edit&mode=edit';

    const promise = callMarklabTool('marklab_join', { link, target }, {
      env: testEnv({
        MARKLAB_APP_SUPPORT_DIR: appSupportDir,
        MARKLAB_NATIVE_CLI_TIMEOUT_MS: '5000',
      }),
    });
    const request = await waitForNativeRequest(appSupportDir);
    expect(request).toMatchObject({
      action: 'join',
      file: target,
      link,
      role: 'edit',
    });
    await writeNativeResponse(appSupportDir, request, {
      ok: true,
      action: 'native_join_started',
      file: target,
      docId: 'doc_join',
      branchId: 'branch_main',
      opened: false,
    });

    await expect(promise).resolves.toMatchObject({
      ok: true,
      data: {
        action: 'native_join_started',
        path: target,
        docId: 'doc_join',
        branchId: 'branch_main',
      },
    });
  });

  it('redacts tokenized link-only join outputs', async () => {
    const link = 'https://app.example.test/collab?docId=doc_join&branchId=branch_main&token=ml_access_edit&mode=edit';
    const result = await callMarklabTool('marklab_join', { link }, {
      env: testEnv(),
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        opened: false,
        link: expect.stringContaining('token=REDACTED'),
        nativeJoinUrl: expect.stringContaining('token%3DREDACTED'),
      },
    });
    expect(JSON.stringify(result)).not.toContain('ml_access_edit');
  });
});
