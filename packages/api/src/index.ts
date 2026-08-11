#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { openDatabase } from '@contextsource/core';
import { createApp } from './app.js';
import { currentRevision } from './git.js';

const { values } = parseArgs({
  options: {
    db: { type: 'string', default: process.env.CONTEXTSOURCE_DB ?? './data/contextsource.sqlite' },
    'workspace-root': {
      type: 'string',
      default: process.env.CONTEXTSOURCE_WORKSPACE_ROOT ?? process.cwd(),
    },
    port: { type: 'string', default: process.env.PORT ?? '9080' },
  },
});

const db = openDatabase(path.resolve(values.db!));
const workspaceRoot = path.resolve(values['workspace-root']!);

const app = createApp({
  db,
  workspaceRoot,
  resolveRevision: (repoRoot) => currentRevision(repoRoot),
});

const port = Number(values.port);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[contextsource-api] listening on http://localhost:${port}/api/v1 (workspace-root=${workspaceRoot}, db=${values.db})`,
  );
});
