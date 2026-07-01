import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mapCliEnvelope, toolError, type ToolResult } from './result.js';

const execFileAsync = promisify(execFile);

export interface RunMarklabOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  cwd?: string;
}

interface Invocation {
  command: string;
  args: string[];
}

function resolveInvocation(args: string[], env: NodeJS.ProcessEnv): Invocation {
  const configured = env.MARKLAB_CLI_PATH?.trim();
  if (!configured) return { command: 'marklab', args };

  if (configured.endsWith('.mjs') || configured.endsWith('.js')) {
    return { command: process.execPath, args: [configured, ...args] };
  }
  return { command: configured, args };
}

function parseCliJson(stdout: unknown): unknown | null {
  const text = String(stdout ?? '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mapProcessFailure(error: unknown): ToolResult {
  const maybe = error as { stdout?: unknown; code?: unknown; signal?: unknown };
  const parsed = parseCliJson(maybe.stdout);
  if (parsed) return mapCliEnvelope(parsed);

  const details: Record<string, unknown> = {};
  if (maybe.code !== undefined) details.exitCode = maybe.code;
  if (maybe.signal !== undefined) details.signal = maybe.signal;
  return toolError('marklab_cli_failed', 'marklab CLI failed before returning a JSON envelope.', details);
}

export async function runMarklabJson(args: string[], options: RunMarklabOptions = {}): Promise<ToolResult> {
  const env = options.env ?? process.env;
  const invocation = resolveInvocation(args, env);
  try {
    const { stdout } = await execFileAsync(invocation.command, invocation.args, {
      cwd: options.cwd,
      env,
      timeout: options.timeoutMs ?? 125000,
      maxBuffer: 1024 * 1024 * 8,
    });
    const parsed = parseCliJson(stdout);
    if (!parsed) {
      return toolError('marklab_cli_invalid_json', 'marklab CLI did not return parseable JSON.');
    }
    return mapCliEnvelope(parsed);
  } catch (error) {
    return mapProcessFailure(error);
  }
}
