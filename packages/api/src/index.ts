#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { openDatabase } from '@contextsource/core';
import { createApp } from './app.js';
import { currentRevision } from './git.js';
import { logInfo } from './logger.js';

const { values } = parseArgs({
  options: {
    db: { type: 'string', default: process.env.CONTEXTSOURCE_DB ?? './data/contextsource.sqlite' },
    'workspace-root': {
      type: 'string',
      default: process.env.CONTEXTSOURCE_WORKSPACE_ROOT ?? process.cwd(),
    },
    port: { type: 'string', default: process.env.PORT ?? '9080' },
    'api-key': { type: 'string', default: process.env.CONTEXTSOURCE_API_KEY },
  },
});

const db = openDatabase(path.resolve(values.db!));
const workspaceRoot = path.resolve(values['workspace-root']!);
// 옵트인 — 미설정이면 기존 로컬 단일 사용자 전제 그대로 동작한다 (ADR-0010, BENCHMARK.md 5.12).
const apiKey = values['api-key'] || undefined;

const app = createApp({
  db,
  workspaceRoot,
  resolveRevision: (repoRoot) => currentRevision(repoRoot),
  apiKey,
});

const port = Number(values.port);
app.listen(port, () => {
  logInfo('server_started', {
    port,
    workspaceRoot,
    db: values.db,
    apiKeyEnabled: Boolean(apiKey),
  });
});
