import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const marklabCliPath = join(repoRoot, 'apps/cli/marklab.mjs');

export function markdownHash(markdown: string): string {
  return `sha256:${createHash('sha256').update(markdown, 'utf8').digest('hex')}`;
}

export function testEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MARKLAB_CLI_PATH: marklabCliPath,
    MARKLAB_NO_OPEN: 'true',
    MARKLAB_DOCTOR_SKIP_NETWORK: '1',
    ...extra,
  };
}

export function nativeConflictFileName(filePath: string): string {
  return `${Buffer.from(resolve(filePath), 'utf8')
    .toString('base64')
    .replaceAll('/', '_')
    .replaceAll('+', '-')
    .replaceAll('=', '')}.json`;
}

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function writeNativeSharedState(input: {
  appSupportDir: string;
  file: string;
  markdown: string;
  docId?: string;
  branchId?: string;
  token?: string | null;
  baselineHash?: string;
  writeBaseline?: boolean;
}): Promise<{ canonicalPath: string; hash: string; docId: string; branchId: string }> {
  const canonicalPath = await realpath(input.file);
  const hash = markdownHash(input.markdown);
  const docId = input.docId ?? 'doc_native';
  const branchId = input.branchId ?? 'branch_native';
  const now = '2026-07-01T12:00:00Z';
  await mkdir(input.appSupportDir, { recursive: true });
  await writeFile(join(input.appSupportDir, 'shared-document-bindings.json'), JSON.stringify({
    schemaVersion: 1,
    bindings: {
      [canonicalPath]: {
        schemaVersion: 1,
        filePath: canonicalPath,
        docId,
        branchId,
        mode: 'edit',
        token: input.token ?? null,
        appEditorURL: `https://app.example.test/collab?docId=${docId}&branchId=${branchId}&mode=edit&clientKind=app&nativeShell=markedit`,
        localDocId: 'local_native',
        baselineHash: input.baselineHash ?? hash,
        createdAt: now,
        updatedAt: now,
      },
    },
  }), 'utf8');

  if (input.writeBaseline !== false) {
    await writeFile(join(input.appSupportDir, 'projection-baselines.json'), JSON.stringify({
      schemaVersion: 1,
      baselines: {
        [canonicalPath]: {
          schemaVersion: 1,
          lastProjectedMarkdown: input.markdown,
          lastProjectedHash: input.baselineHash ?? hash,
          lastProviderStateFingerprint: `provider-ytext:${input.baselineHash ?? hash}`,
          updatedAt: now,
        },
      },
    }), 'utf8');
  }

  return { canonicalPath, hash, docId, branchId };
}

export async function startExportServer(markdownByBranch: Map<string, string>, options: {
  authorize?: (req: http.IncomingMessage) => boolean;
} = {}): Promise<{
  apiUrl: string;
  requests: Array<{ method: string | undefined; url: string | undefined; authorization: string | undefined }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{ method: string | undefined; url: string | undefined; authorization: string | undefined }> = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    const match = /^\/api\/docs\/([^/]+)\/branches\/([^/]+)\/export\.md$/u.exec(req.url ?? '');
    if (req.method === 'GET' && match?.[1] && match[2]) {
      if (options.authorize && !options.authorize(req)) {
        res.statusCode = 403;
        res.end('forbidden');
        return;
      }
      const markdown = markdownByBranch.get(`${decodeURIComponent(match[1])}:${decodeURIComponent(match[2])}`);
      if (markdown === undefined) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.setHeader('content-type', 'text/markdown; charset=utf-8');
      res.end(markdown);
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  const port = await new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('missing_test_port'));
      else resolvePort(address.port);
    });
  });
  return {
    apiUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    }),
  };
}

export async function waitForNativeRequest(appSupportDir: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
  const requestsDir = join(appSupportDir, 'cli-requests');
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const files = (await readdir(requestsDir)).filter((file) => file.endsWith('.json'));
      if (files.length > 0 && files[0]) {
        return JSON.parse(await readFile(join(requestsDir, files[0]), 'utf8'));
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw lastError instanceof Error ? lastError : new Error('Timed out waiting for native request.');
}

export async function writeNativeResponse(appSupportDir: string, request: Record<string, unknown>, response: Record<string, unknown>): Promise<void> {
  const requestId = String(request.requestId);
  const responseDir = join(appSupportDir, 'cli-responses');
  await mkdir(responseDir, { recursive: true });
  await writeFile(join(responseDir, `${requestId}.json`), JSON.stringify({ requestId, ...response }), 'utf8');
}
