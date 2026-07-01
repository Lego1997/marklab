import { describe, expect, it } from 'vitest';
import { callMarklabTool } from '../src/tools';

// Regression guard for the wait_synced timeout race: an out-of-range timeout_ms must be
// rejected up front (before the CLI is spawned) so it can never exceed the child-process
// budget and get SIGKILLed into a generic marklab_cli_failed envelope.
describe('marklab_wait_synced timeout_ms bounds', () => {
  const file = '/tmp/marklab-wait-timeout-bound.md';

  it('rejects a timeout_ms above the maximum without invoking the CLI', async () => {
    const result = await callMarklabTool('marklab_wait_synced', { file, timeout_ms: 700000 });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
  });

  it('rejects a non-positive timeout_ms', async () => {
    const result = await callMarklabTool('marklab_wait_synced', { file, timeout_ms: 0 });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_arguments' } });
  });
});
