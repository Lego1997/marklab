import { isAbsolute } from 'node:path';
import { runMarklabJson, type RunMarklabOptions } from './marklab-cli.js';
import { redactSecretsDeep, redactToolData } from './redaction.js';
import { toolError, type JsonObject, type ToolResult } from './result.js';

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, JsonObject>;
    required?: string[];
    additionalProperties: false;
  };
  annotations?: JsonObject;
}

const fileProperty = {
  type: 'string',
  description: 'Absolute path to a local Markdown file on disk.',
};

const optionalFileProperty = {
  type: 'string',
  description: 'Optional absolute path to a local Markdown file on disk.',
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'marklab_open',
    title: 'Open MarkLab File',
    description: 'Open an absolute Markdown file path in MarkLab.app. This may launch the native app.',
    inputSchema: {
      type: 'object',
      properties: { file: fileProperty },
      required: ['file'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'marklab_share',
    title: 'Create MarkLab Share Link',
    description: 'Ask MarkLab.app to create an edit or view share link for an absolute Markdown file path. Tokenized URLs are redacted by default.',
    inputSchema: {
      type: 'object',
      properties: {
        file: fileProperty,
        role: { type: 'string', enum: ['edit', 'view'] },
      },
      required: ['file', 'role'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'marklab_join',
    title: 'Join MarkLab Share Link',
    description: 'Join a hosted MarkLab edit link, optionally binding it to an explicit absolute target path. Link-only joins open MarkLab.app.',
    inputSchema: {
      type: 'object',
      properties: {
        link: { type: 'string', description: 'Hosted MarkLab /collab edit link.' },
        target: { type: 'string', description: 'Optional absolute target Markdown file path for native binding.' },
      },
      required: ['link'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'marklab_status',
    title: 'Read MarkLab Sync Status',
    description: 'Read MarkLab native sync state for an absolute Markdown file path. provider_unknown is caution, not convergence.',
    inputSchema: {
      type: 'object',
      properties: { file: optionalFileProperty },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'marklab_wait_synced',
    title: 'Wait For MarkLab Sync',
    description: 'Wait until a shared Markdown file is synced according to MarkLab status and provider verification.',
    inputSchema: {
      type: 'object',
      properties: {
        file: fileProperty,
        timeout_ms: { type: 'integer', minimum: 1, maximum: 600000, default: 10000 },
      },
      required: ['file'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'marklab_conflict',
    title: 'Read MarkLab Conflict',
    description: 'Read the open native conflict state for an absolute Markdown file path. Resolution happens in MarkLab.app.',
    inputSchema: {
      type: 'object',
      properties: { file: fileProperty },
      required: ['file'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'marklab_doctor',
    title: 'Run MarkLab Doctor',
    description: 'Run MarkLab diagnostics. This is side-effecting: it writes/removes a temp probe and may call /healthz.',
    inputSchema: {
      type: 'object',
      properties: { file: optionalFileProperty },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function requiredString(input: JsonObject, name: string): string | ToolResult {
  const value = input[name];
  if (typeof value === 'string' && value.trim()) return value;
  return toolError('invalid_arguments', `${name} is required.`);
}

function optionalString(input: JsonObject, name: string): string | undefined | ToolResult {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value.trim()) return value;
  return toolError('invalid_arguments', `${name} must be a non-empty string when provided.`);
}

function absolutePath(value: string, name: string): string | ToolResult {
  if (isAbsolute(value)) return value;
  return toolError('invalid_arguments', `${name} must be an absolute path.`, { path: value });
}

function optionalAbsolutePath(input: JsonObject, name: string): string | undefined | ToolResult {
  const value = optionalString(input, name);
  if (typeof value !== 'string') return value;
  return absolutePath(value, name);
}

const DEFAULT_WAIT_TIMEOUT_MS = 10000;
const MAX_WAIT_TIMEOUT_MS = 600000;
const WAIT_TIMEOUT_BUFFER_MS = 5000;

function timeoutMs(input: JsonObject): number | ToolResult {
  const value = input.timeout_ms;
  if (value === undefined) return DEFAULT_WAIT_TIMEOUT_MS;
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_WAIT_TIMEOUT_MS) {
    return value;
  }
  return toolError('invalid_arguments', `timeout_ms must be a positive integer no greater than ${MAX_WAIT_TIMEOUT_MS}.`);
}

function addProviderUnknownCaution(result: ToolResult, toolName: string): ToolResult {
  if (toolName !== 'marklab_status' || result.ok !== true || result.data.syncState !== 'provider_unknown') return result;
  return {
    ok: true,
    data: {
      ...result.data,
      caution: 'provider export verification is unavailable; do not claim the document converged until a later status or wait confirms synced.',
    },
  };
}

function sanitizeResult(result: ToolResult, toolName: string): ToolResult {
  const cautioned = addProviderUnknownCaution(result, toolName);
  if (cautioned.ok) {
    return { ok: true, data: redactToolData(cautioned.data) };
  }
  return { ok: false, error: redactSecretsDeep(cautioned.error) };
}

async function invoke(args: string[], toolName: string, options?: RunMarklabOptions): Promise<ToolResult> {
  return sanitizeResult(await runMarklabJson(args, options), toolName);
}

export async function callMarklabTool(name: string, rawInput: unknown = {}, options?: RunMarklabOptions): Promise<ToolResult> {
  const input = asRecord(rawInput);

  if (name === 'marklab_open') {
    const file = requiredString(input, 'file');
    if (typeof file !== 'string') return file;
    const path = absolutePath(file, 'file');
    if (typeof path !== 'string') return path;
    return invoke(['open', path, '--json'], name, options);
  }

  if (name === 'marklab_share') {
    const file = requiredString(input, 'file');
    if (typeof file !== 'string') return file;
    const path = absolutePath(file, 'file');
    if (typeof path !== 'string') return path;
    const role = input.role;
    if (role !== 'edit' && role !== 'view') return toolError('invalid_arguments', 'role must be edit or view.');
    return invoke(['share', path, `--${role}`, '--json'], name, options);
  }

  if (name === 'marklab_join') {
    const link = requiredString(input, 'link');
    if (typeof link !== 'string') return link;
    const target = optionalAbsolutePath(input, 'target');
    if (target && typeof target !== 'string') return target;
    return invoke(target ? ['join', link, target, '--json'] : ['join', link, '--json'], name, options);
  }

  if (name === 'marklab_status') {
    const file = optionalAbsolutePath(input, 'file');
    if (file && typeof file !== 'string') return file;
    return invoke(file ? ['status', file, '--json'] : ['status', '--json'], name, options);
  }

  if (name === 'marklab_wait_synced') {
    const file = requiredString(input, 'file');
    if (typeof file !== 'string') return file;
    const path = absolutePath(file, 'file');
    if (typeof path !== 'string') return path;
    const timeout = timeoutMs(input);
    if (typeof timeout !== 'number') return timeout;
    // Give the child process a larger budget than the CLI's own wait timeout so the CLI can
    // return its structured sync_timeout envelope instead of being killed by execFile.
    const waitOptions: RunMarklabOptions = { ...(options ?? {}), timeoutMs: timeout + WAIT_TIMEOUT_BUFFER_MS };
    return invoke(['wait', path, '--synced', '--timeout', String(timeout), '--json'], name, waitOptions);
  }

  if (name === 'marklab_conflict') {
    const file = requiredString(input, 'file');
    if (typeof file !== 'string') return file;
    const path = absolutePath(file, 'file');
    if (typeof path !== 'string') return path;
    return invoke(['conflict', path, '--json'], name, options);
  }

  if (name === 'marklab_doctor') {
    const file = optionalAbsolutePath(input, 'file');
    if (file && typeof file !== 'string') return file;
    return invoke(file ? ['doctor', file, '--json'] : ['doctor', '--json'], name, options);
  }

  return toolError('unknown_tool', `Unknown MarkLab tool: ${name}`);
}
