import { execFile } from 'node:child_process';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createYjsProvider, STATUS_CONNECTED, type YSweetProvider } from '@y-sweet/client';
import type { ClientToken } from '@y-sweet/sdk';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import type { DbPool, DbQueryResult, DbTransactionClient } from '../../api/src/db/client';
import { createHttpApp, type HttpRequestAuth } from '../../api/src/http/app';
import { createYSweetSnapshotService, createYSweetTokenService } from '../../api/src/provider/ysweet-token-service';
import {
  loadYSweetProviderProcessConfig,
  readYSweetProviderHealth,
  startYSweetProviderProcess,
  stopYSweetProviderProcess,
  type YSweetProviderHandle,
} from '../../api/src/provider/ysweet-provider-process';
import {
  isYSweetProviderHttpPath,
  isYSweetProviderWebSocketPath,
  proxyYSweetProviderHttpRequest,
  proxyYSweetProviderWebSocketUpgrade,
} from '../../api/src/provider/ysweet-provider-websocket-proxy';
import { createHeadlessMilkdownRuntime } from '../../api/src/services/milkdown-headless-runtime';
import { createUnavailableLiveMarkdownWriter } from '../../api/src/services/live-writer';

const runRealE2E = process.env.MARKLAB_ROUNDTRIP_E2E === '1' ? it : it.skip;
const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const docId = 'doc_codex_plugin_roundtrip_e2e';
const branchId = 'branch_codex_plugin_roundtrip_e2e';
const providerDocId = 'ml_doc_codex_plugin_roundtrip_e2e';

async function createYSweetAuthPair(): Promise<{ privateKey: string; serverToken: string }> {
  const result = await execFileAsync(
    'npx',
    ['-y', 'pnpm@10.0.0', '--filter', '@marklab/api', 'exec', 'y-sweet', 'gen-auth', '--json'],
    { cwd: repoRoot },
  );
  const body = JSON.parse(result.stdout) as { private_key?: string; server_token?: string };
  if (!body.private_key || !body.server_token) throw new Error('ysweet_gen_auth_failed');
  return { privateKey: body.private_key, serverToken: body.server_token };
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('free_port_unavailable')));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForProviderReady(handle: YSweetProviderHandle, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  let lastError = 'provider_not_ready';
  while (Date.now() - startedAt < timeoutMs) {
    const health = await readYSweetProviderHealth(handle);
    if (health.ready && health.storeReady) return;
    lastError = health.error ?? lastError;
    await delay(150);
  }
  throw new Error(`provider_ready_timeout:${lastError}`);
}

function createRoundtripPool(initialYjsState: Uint8Array): DbPool {
  let providerSeeded = false;
  const query: DbPool['query'] = async <Row = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<DbQueryResult<Row>> => {
    if (/insert into collab_sessions/u.test(sql)) return { rows: [{ id: params?.[0] } as Row], rowCount: 1 };
    if (/update collab_sessions/u.test(sql)) return { rows: [], rowCount: 1 };
    if (/insert into provider_token_issuances/u.test(sql)) {
      return { rows: [{ id: `issuance_${params?.[0] ?? 'roundtrip'}` } as Row], rowCount: 1 };
    }
    if (/select 1\s+from provider_token_issuances pending/u.test(sql)) {
      return { rows: [{ active: 1 } as Row], rowCount: 1 };
    }
    if (/pending\.status = 'pending'/u.test(sql)) return { rows: [], rowCount: 1 };
    if (/update document_branch_states[\s\S]+provider_doc_seeded_at = now/u.test(sql)) {
      providerSeeded = true;
      return { rows: [], rowCount: 1 };
    }
    if (/update provider_token_issuances/u.test(sql)) return { rows: [], rowCount: 1 };
    if (/select s\.provider_doc_seeded_at/u.test(sql)) {
      return {
        rows: [{
          provider_doc_seeded_at: providerSeeded ? '2026-07-01T12:00:00Z' : null,
          yjs_state: Buffer.from(initialYjsState),
        } as Row],
        rowCount: 1,
      };
    }
    if (/select s\.provider_doc_id/u.test(sql)) {
      return {
        rows: [{
          provider_doc_id: providerDocId,
          provider_doc_seeded_at: providerSeeded ? '2026-07-01T12:00:00Z' : null,
          yjs_state: Buffer.from(initialYjsState),
        } as Row],
        rowCount: 1,
      };
    }
    if (/select d\.title/u.test(sql)) {
      return {
        rows: [{
          title: 'Codex plugin roundtrip',
          branch_slug: 'main',
          version_number: 1,
        } as Row],
        rowCount: 1,
      };
    }
    if (/from documents d/u.test(sql)) {
      return {
        rows: [{
          doc_id: docId,
          branch_id: branchId,
          version_id: 'version_roundtrip_e2e',
          version_number: 1,
          current_hash: 'sha256:roundtrip',
          current_markdown: '',
        } as Row],
        rowCount: 1,
      };
    }
    if (/^(begin|commit|rollback)$/iu.test(sql.trim())) return { rows: [], rowCount: 0 };
    if (/pg_advisory_xact_lock/u.test(sql)) return { rows: [{} as Row], rowCount: 1 };
    throw new Error(`unexpected_roundtrip_query:${sql}`);
  };

  return {
    query,
    async connect(): Promise<DbTransactionClient> {
      return { query, release: () => undefined };
    },
  };
}

function createRoundtripAuth(): HttpRequestAuth {
  return {
    async requireAdminAccess() {},
    async requireDocumentAccess() {
      return { actorType: 'user', actorId: 'roundtrip-user', role: 'edit' };
    },
  };
}

async function listen(server: http.Server, port: number): Promise<void> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolveListen();
    });
  });
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolveClose) => {
    server.close(() => resolveClose());
  });
}

async function requestEditSession(apiPort: number, clientKind: 'app' | 'browser', displayName: string): Promise<ClientToken> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (clientKind === 'app') {
    headers.authorization = 'Bearer ml_user_roundtrip';
    headers['x-marklab-native-app'] = '1';
  }
  const response = await fetch(`http://127.0.0.1:${apiPort}/api/docs/${docId}/branches/${branchId}/collab/session`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'edit', clientKind, displayName }),
  });
  if (!response.ok) throw new Error(`collab_session_failed:${response.status}:${await response.text()}`);
  const body = await response.json() as { providerToken?: { clientToken?: ClientToken } };
  if (!body.providerToken?.clientToken) throw new Error('collab_session_missing_client_token');
  return body.providerToken.clientToken;
}

function connectClient(doc: Y.Doc, clientToken: ClientToken): YSweetProvider {
  return createYjsProvider(doc, clientToken.docId, async () => clientToken, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    showDebuggerLink: false,
  });
}

async function waitForConnection(provider: YSweetProvider, timeoutMs = 5_000): Promise<void> {
  if (provider.status === STATUS_CONNECTED) return;
  await new Promise<void>((resolveConnected, reject) => {
    const timer = setTimeout(() => {
      provider.off('connection-status', onStatus);
      reject(new Error(`provider_connection_timeout:${provider.status}`));
    }, timeoutMs);
    function onStatus(status: string) {
      if (status !== STATUS_CONNECTED) return;
      clearTimeout(timer);
      provider.off('connection-status', onStatus);
      resolveConnected();
    }
    provider.on('connection-status', onStatus);
  });
}

async function waitForNoLocalChanges(provider: YSweetProvider, timeoutMs = 5_000): Promise<void> {
  if (!provider.hasLocalChanges) return;
  await new Promise<void>((resolveSettled, reject) => {
    const timer = setTimeout(() => {
      provider.off('local-changes', onLocalChanges);
      reject(new Error('provider_local_changes_timeout'));
    }, timeoutMs);
    function onLocalChanges(hasLocalChanges: boolean) {
      if (hasLocalChanges) return;
      clearTimeout(timer);
      provider.off('local-changes', onLocalChanges);
      resolveSettled();
    }
    provider.on('local-changes', onLocalChanges);
  });
}

async function waitUntil(label: string, predicate: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<number> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return Date.now() - startedAt;
    await delay(50);
  }
  throw new Error(`timeout:${label}`);
}

async function createHeadlessNativeDiskBridge(ytext: Y.Text, filePath: string): Promise<{
  stop(): Promise<void>;
  hasConflict(): boolean;
}> {
  let lastProjectedMarkdown = await readFile(filePath, 'utf8');
  let conflict = false;
  let queued = Promise.resolve();

  const reconcile = () => {
    queued = queued.then(async () => {
      if (conflict) return;
      const providerMarkdown = ytext.toString();
      const diskMarkdown = await readFile(filePath, 'utf8');
      if (diskMarkdown === providerMarkdown) {
        lastProjectedMarkdown = providerMarkdown;
        return;
      }
      if (diskMarkdown === lastProjectedMarkdown) {
        await writeFile(filePath, providerMarkdown, 'utf8');
        lastProjectedMarkdown = providerMarkdown;
        return;
      }
      if (diskMarkdown.startsWith(lastProjectedMarkdown) && providerMarkdown.startsWith(lastProjectedMarkdown)) {
        ytext.insert(lastProjectedMarkdown.length, diskMarkdown.slice(lastProjectedMarkdown.length));
        lastProjectedMarkdown = diskMarkdown;
        return;
      }
      conflict = true;
    });
  };

  const timer = setInterval(reconcile, 25);
  ytext.observe(reconcile);
  reconcile();

  return {
    async stop() {
      clearInterval(timer);
      ytext.unobserve(reconcile);
      await queued;
    },
    hasConflict() {
      return conflict;
    },
  };
}

async function fetchExportMarkdown(apiPort: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${apiPort}/api/docs/${docId}/branches/${branchId}/export.md`, {
    headers: { authorization: 'Bearer ml_user_roundtrip' },
  });
  if (!response.ok) throw new Error(`export_failed:${response.status}:${await response.text()}`);
  return response.text();
}

function containsBoth(markdown: string, humanSentinel: string, codexSentinel: string): boolean {
  return markdown.includes(humanSentinel) && markdown.includes(codexSentinel);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

describe('real roundtrip convergence E2E', () => {
  runRealE2E('preserves concurrent human and Codex sentinels on disk and export.md within the SLO', async () => {
    const root = await mkdtemp(join(tmpdir(), 'marklab-codex-roundtrip-e2e-'));
    const storePath = join(root, 'ysweet');
    const diskPath = join(root, 'roundtrip.md');
    await mkdir(storePath, { recursive: true });
    await writeFile(diskPath, '', 'utf8');

    const providerPort = await getFreePort();
    const apiPort = await getFreePort();
    const auth = await createYSweetAuthPair();
    const providerConfig = loadYSweetProviderProcessConfig({
      MARKLAB_YSWEET_PROVIDER_MODE: 'process',
      MARKLAB_YSWEET_SERVER_URL: `http://127.0.0.1:${providerPort}`,
      MARKLAB_YSWEET_PUBLIC_URL_PREFIX: `http://127.0.0.1:${apiPort}`,
      MARKLAB_YSWEET_STORE_PATH: storePath,
      MARKLAB_YSWEET_AUTH: auth.privateKey,
      MARKLAB_YSWEET_SERVER_TOKEN: auth.serverToken,
      MARKLAB_YSWEET_CHECKPOINT_FREQ_SECONDS: '1',
    }, { cwd: repoRoot, requireAuth: true, requireServerToken: true, requireStorePath: true });
    if (!providerConfig.connectionString) throw new Error('roundtrip_connection_string_missing');

    const initialState = await createHeadlessMilkdownRuntime().initializeFromMarkdown('');
    const pool = createRoundtripPool(initialState.yjsState);
    const provider = startYSweetProviderProcess(providerConfig);
    const app = createHttpApp(pool, createUnavailableLiveMarkdownWriter(), {
      auth: createRoundtripAuth(),
      providerTokenService: createYSweetTokenService({ connectionString: providerConfig.connectionString }),
      collabSnapshotService: createYSweetSnapshotService({ pool, connectionString: providerConfig.connectionString }),
      providerHttpProxy: (request, response, next) => {
        if (!isYSweetProviderHttpPath(request.originalUrl ?? request.url)) {
          next();
          return;
        }
        proxyYSweetProviderHttpRequest(provider.serverUrl, request, response);
      },
      health: {
        providerRequired: true,
        providerHealth: () => readYSweetProviderHealth(provider),
      },
    });
    const apiServer = http.createServer(app);
    apiServer.on('upgrade', (request, socket, head) => {
      if (!isYSweetProviderWebSocketPath(request.url)) {
        socket.destroy();
        return;
      }
      proxyYSweetProviderWebSocketUpgrade(provider.serverUrl, request, socket, head);
    });

    let nativeProvider: YSweetProvider | null = null;
    let browserProvider: YSweetProvider | null = null;
    let bridge: Awaited<ReturnType<typeof createHeadlessNativeDiskBridge>> | null = null;
    try {
      await waitForProviderReady(provider);
      await listen(apiServer, apiPort);
      const [nativeToken, browserToken] = await Promise.all([
        requestEditSession(apiPort, 'app', 'Headless MarkLab native bridge'),
        requestEditSession(apiPort, 'browser', 'Headless browser collaborator'),
      ]);

      const nativeDoc = new Y.Doc();
      const browserDoc = new Y.Doc();
      nativeProvider = connectClient(nativeDoc, nativeToken);
      browserProvider = connectClient(browserDoc, browserToken);
      await Promise.all([waitForConnection(nativeProvider), waitForConnection(browserProvider)]);

      const nativeText = nativeDoc.getText('contents');
      const browserText = browserDoc.getText('contents');
      bridge = await createHeadlessNativeDiskBridge(nativeText, diskPath);

      const base = 'Base document\n';
      nativeText.insert(0, base);
      await waitForNoLocalChanges(nativeProvider);
      await waitUntil('browser sees base', () => browserText.toString() === base);
      await waitUntil('disk receives base', async () => (await readFile(diskPath, 'utf8')) === base);

      const humanSentinel = `HUMAN_SENTINEL_${Date.now()}`;
      const codexSentinel = `CODEX_SENTINEL_${Date.now()}`;
      const startedAt = Date.now();
      browserText.insert(browserText.length, `${humanSentinel}\n`);
      await writeFile(diskPath, `${base}${codexSentinel}\n`, 'utf8');
      await Promise.all([waitForNoLocalChanges(browserProvider), waitForNoLocalChanges(nativeProvider)]);

      const diskLatencyMs = await waitUntil('disk contains both sentinels', async () => (
        containsBoth(await readFile(diskPath, 'utf8'), humanSentinel, codexSentinel)
      ));
      const exportLatencyMs = await waitUntil('export contains both sentinels', async () => (
        containsBoth(await fetchExportMarkdown(apiPort), humanSentinel, codexSentinel)
      ));
      const totalLatencyMs = Date.now() - startedAt;
      const diskMarkdown = await readFile(diskPath, 'utf8');
      const exportMarkdown = await fetchExportMarkdown(apiPort);

      expect(bridge.hasConflict()).toBe(false);
      expect(containsBoth(nativeText.toString(), humanSentinel, codexSentinel)).toBe(true);
      expect(containsBoth(browserText.toString(), humanSentinel, codexSentinel)).toBe(true);
      expect(containsBoth(diskMarkdown, humanSentinel, codexSentinel)).toBe(true);
      expect(containsBoth(exportMarkdown, humanSentinel, codexSentinel)).toBe(true);
      expect(totalLatencyMs).toBeLessThanOrEqual(10_000);

      console.log(JSON.stringify({
        ok: true,
        ac: 'AC2b',
        providerDocId,
        diskPath,
        humanSentinel,
        codexSentinel,
        diskContainsBoth: true,
        exportContainsBoth: true,
        diskLatencyMs,
        exportLatencyMs,
        totalLatencyMs,
      }));
    } finally {
      await bridge?.stop().catch(() => undefined);
      nativeProvider?.disconnect();
      browserProvider?.disconnect();
      nativeProvider?.destroy();
      browserProvider?.destroy();
      await closeServer(apiServer).catch(() => undefined);
      await stopYSweetProviderProcess(provider).catch(() => undefined);
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 90_000);
});
