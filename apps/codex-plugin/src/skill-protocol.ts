import { readFile } from 'node:fs/promises';
import { callMarklabTool } from './tools.js';
import type { ToolResult } from './result.js';

export interface SkillEditAttemptInput {
  file: string;
  sentinel: string;
  env?: NodeJS.ProcessEnv;
  writeText?: (file: string, text: string) => Promise<void>;
}

function runOptions(env: NodeJS.ProcessEnv | undefined): { env?: NodeJS.ProcessEnv } {
  return env ? { env } : {};
}

function stopResult(details: unknown): ToolResult {
  return {
    ok: false,
    error: {
      code: 'conflict_required',
      message: 'STOP: MarkLab reports a conflict for this file.',
      details,
      nextStep: 'STOP editing this file. Surface marklab_conflict output and ask the user to resolve the conflict in MarkLab.app before continuing.',
    },
  };
}

export async function runSkillEditAttempt(input: SkillEditAttemptInput): Promise<ToolResult> {
  const options = runOptions(input.env);
  const conflict = await callMarklabTool('marklab_conflict', { file: input.file }, options);
  if (conflict.ok && (conflict.data.hasConflict === true || conflict.data.syncState === 'conflict')) {
    return stopResult(conflict.data);
  }
  if (!conflict.ok) return conflict;

  const status = await callMarklabTool('marklab_status', { file: input.file }, options);
  if (status.ok && status.data.syncState === 'conflict') {
    return stopResult(status.data);
  }
  if (!status.ok) return status;

  const original = await readFile(input.file, 'utf8');
  const next = original.endsWith('\n') ? `${original}${input.sentinel}\n` : `${original}\n${input.sentinel}\n`;
  await (input.writeText ?? (async () => undefined))(input.file, next);
  return callMarklabTool('marklab_wait_synced', { file: input.file }, options);
}
