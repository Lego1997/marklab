import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS } from '../src/tools';
import { repoRoot } from './helpers';

describe('plugin registration metadata', () => {
  it('registers exactly the 7 MarkLab coordination tools', () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name).sort()).toEqual([
      'marklab_conflict',
      'marklab_doctor',
      'marklab_join',
      'marklab_open',
      'marklab_share',
      'marklab_status',
      'marklab_wait_synced',
    ]);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  it('pins the current Codex plugin manifest and MCP wrapper shape', async () => {
    const pluginRoot = join(repoRoot, 'apps/codex-plugin');
    const manifest = JSON.parse(await readFile(join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'));
    const mcp = JSON.parse(await readFile(join(pluginRoot, '.mcp.json'), 'utf8'));

    expect(manifest).toMatchObject({
      name: 'marklab-codex',
      mcpServers: './.mcp.json',
      skills: './skills/',
      interface: {
        displayName: 'MarkLab for Codex',
      },
    });
    expect(mcp).toEqual({
      mcpServers: {
        marklab: {
          command: 'node',
          args: ['./dist/server.js', '--stdio'],
        },
      },
    });
  });
});
