import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  analyzeProject,
  fileEntityId,
  openDatabase,
  replaceProjectGraph,
  symbolEntityId,
  upsertProject,
} from '@contextsource/core';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureTsconfig = path.join(
  testDir,
  '../../core/test/fixtures/overload-generic/tsconfig.json',
);
const serverEntry = path.join(testDir, '../dist/index.js');

const PROJECT = 'p1';
let dbPath: string;
let client: Client;
let transport: StdioClientTransport;

function textOf(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content.find((c) => c.type === 'text')?.text;
  return text ? JSON.parse(text) : undefined;
}

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-mcp-')), 'db.sqlite');
  const db = openDatabase(dbPath);
  upsertProject(db, { id: PROJECT, name: 'overload-generic', rootPath: '/fixtures/overload-generic', tsconfigPath: fixtureTsconfig });
  const result = analyzeProject({ tsconfigPath: fixtureTsconfig, projectId: PROJECT, revision: 'rev1' });
  replaceProjectGraph(db, PROJECT, result.entities, result.relationships);
  db.close();

  expect(fs.existsSync(serverEntry)).toBe(true);

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry, '--db', dbPath, '--project-id', PROJECT],
  });
  client = new Client({ name: 'test-client', version: '0.1.0' });
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

describe('MCP server (stdio) — read-only tools over a real analyzed project', () => {
  it('lists exactly the 6 required tools (API.md §3, ADR-0012)', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ['build_context', 'get_callees', 'get_callers', 'get_entity', 'get_subgraph', 'search_entities'].sort(),
    );
  });

  it('search_entities finds identity()', async () => {
    const res = await client.callTool({ name: 'search_entities', arguments: { name: 'identity' } });
    const body = textOf(res as any) as { items: { id: string; name: string }[]; total: number };
    expect(body.items.some((e) => e.name === 'identity')).toBe(true);
  });

  it('get_entity returns entity + relationshipCounts, including Evidence-bearing relations elsewhere', async () => {
    const id = symbolEntityId(PROJECT, 'src/math.ts', 'identity');
    const res = await client.callTool({ name: 'get_entity', arguments: { id } });
    const body = textOf(res as any) as { entity: { id: string }; relationshipCounts: { in: number; out: number } };
    expect(body.entity.id).toBe(id);
    expect(body.relationshipCounts.in).toBeGreaterThan(0);
  });

  it('get_entity on an unknown id returns an MCP tool error', async () => {
    const res = (await client.callTool({
      name: 'get_entity',
      arguments: { id: 'p1/sym:nope.ts#nope' },
    })) as any;
    expect(res.isError).toBe(true);
  });

  it('get_callers returns caller with Evidence', async () => {
    const id = symbolEntityId(PROJECT, 'src/math.ts', 'identity');
    const res = await client.callTool({ name: 'get_callers', arguments: { id } });
    const body = textOf(res as any) as {
      items: { relationship: { evidence: unknown[] }; counterpart: { name: string } }[];
    };
    expect(body.items[0]?.counterpart.name).toBe('run');
    expect(body.items[0]?.relationship.evidence.length).toBeGreaterThan(0);
  });

  it('get_callees returns callees of run()', async () => {
    const id = symbolEntityId(PROJECT, 'src/usage.ts', 'run');
    const res = await client.callTool({ name: 'get_callees', arguments: { id } });
    const body = textOf(res as any) as { items: { counterpart: { name: string } }[] };
    expect(body.items.some((i) => i.counterpart.name === 'identity')).toBe(true);
  });

  it('get_subgraph respects direction/depth/maxNodes and includes Evidence', async () => {
    const id = fileEntityId(PROJECT, 'src/usage.ts');
    const res = await client.callTool({
      name: 'get_subgraph',
      arguments: { id, direction: 'out', depth: 2, maxNodes: 200 },
    });
    const body = textOf(res as any) as {
      entities: unknown[];
      relationships: { evidence: unknown[] }[];
      truncated: boolean;
    };
    expect(body.entities.length).toBeGreaterThan(0);
    for (const rel of body.relationships) expect(rel.evidence.length).toBeGreaterThan(0);
  });

  it('get_subgraph maxNodes acts as a token-budget control (truncated:true)', async () => {
    const id = fileEntityId(PROJECT, 'src/usage.ts');
    const res = await client.callTool({
      name: 'get_subgraph',
      arguments: { id, direction: 'both', depth: 5, maxNodes: 1 },
    });
    const body = textOf(res as any) as { truncated: boolean };
    expect(body.truncated).toBe(true);
  });

  it('build_context finds a seed by name and ranks bidirectional context with a reason (ADR-0012)', async () => {
    const res = await client.callTool({ name: 'build_context', arguments: { query: 'run' } });
    const body = textOf(res as any) as {
      seeds: { id: string }[];
      items: { entity: { name: string }; relationshipType: string; reason: string; evidence: unknown[] }[];
      estimatedTokens: number;
      tokenBudget: number;
      truncated: boolean;
    };
    expect(body.seeds.some((s) => s.id === symbolEntityId(PROJECT, 'src/usage.ts', 'run'))).toBe(true);
    const identityItem = body.items.find((i) => i.entity.name === 'identity');
    expect(identityItem).toBeDefined();
    expect(identityItem?.relationshipType).toBe('CALLS');
    expect(identityItem?.reason.length).toBeGreaterThan(0);
    expect(identityItem?.evidence.length).toBeGreaterThan(0);
    expect(body.tokenBudget).toBe(4000);
  });

  it('build_context tokenBudget acts as a token-budget control (truncated:true)', async () => {
    const res = await client.callTool({ name: 'build_context', arguments: { query: 'run', tokenBudget: 100 } });
    const body = textOf(res as any) as { truncated: boolean; estimatedTokens: number };
    expect(body.truncated).toBe(true);
    expect(body.estimatedTokens).toBeLessThanOrEqual(100);
  });

  it('build_context returns an empty result (not an error) when nothing matches the query', async () => {
    const res = (await client.callTool({
      name: 'build_context',
      arguments: { query: 'NoSuchSymbolXYZ' },
    })) as any;
    expect(res.isError).toBeFalsy();
    const body = textOf(res) as { seeds: unknown[]; items: unknown[] };
    expect(body.seeds).toEqual([]);
    expect(body.items).toEqual([]);
  });
});
