#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openReadOnlyDatabase } from './db.js';
import { buildToolDefinitions } from './tools.js';

const { values } = parseArgs({
  options: {
    db: { type: 'string', default: process.env.CONTEXTSOURCE_DB ?? './data/contextsource.sqlite' },
    'project-id': { type: 'string', default: process.env.CONTEXTSOURCE_PROJECT_ID ?? 'p1' },
  },
});

const db = openReadOnlyDatabase(path.resolve(values.db!));
const projectId = values['project-id']!;

const server = new McpServer({ name: 'contextsource', version: '0.1.0' });

const tools = buildToolDefinitions({ db, projectId });
for (const [name, def] of Object.entries(tools)) {
  server.registerTool(
    name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
    },
    // 5개 tool 핸들러는 각자 다른 zod shape를 갖지만 registerTool의 제네릭 추론 범위 밖에서
    // 동적으로 순회하며 등록하므로, 검증은 zod(inputSchema)가 런타임에 이미 수행한다.
    def.handler as Parameters<typeof server.registerTool>[2],
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[contextsource-mcp] ready — project=${projectId} db=${values.db} (read-only, stdio)`);
