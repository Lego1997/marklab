#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { pathToFileURL } from 'node:url';
import { callMarklabTool, TOOL_DEFINITIONS } from './tools.js';

const instructions = [
  'MarkLab tools are coordination-only. Edit Markdown content through the local file, never through a MarkLab tool.',
  'After editing a shared file, call marklab_wait_synced, then marklab_status or marklab_conflict.',
  'If hasConflict:true or syncState:"conflict", STOP and surface the state. Treat provider_unknown as caution, not convergence.',
  'Share and join outputs redact tokenized URLs by default.',
].join(' ');

export function createMarklabMcpServer(): Server {
  const server = new Server(
    { name: 'marklab-codex', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS as Tool[],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const result = await callMarklabTool(request.params.name, request.params.arguments ?? {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: false,
    };
  });

  return server;
}

async function main(): Promise<void> {
  const server = createMarklabMcpServer();
  await server.connect(new StdioServerTransport());
}

function isDirectInvocation(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

if (isDirectInvocation() || process.argv.includes('--stdio')) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
