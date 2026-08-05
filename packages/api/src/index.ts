#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as path from 'node:path';
import { openDatabase, upsertProject } from '@contextsource/core';
import { createApp } from './app.js';
import { currentRevision } from './git.js';

const { values } = parseArgs({
  options: {
    db: { type: 'string', default: process.env.CONTEXTSOURCE_DB ?? './data/contextsource.sqlite' },
    'project-id': { type: 'string', default: process.env.CONTEXTSOURCE_PROJECT_ID ?? 'p1' },
    'project-name': { type: 'string', default: process.env.CONTEXTSOURCE_PROJECT_NAME ?? 'project' },
    'root-path': { type: 'string', default: process.env.CONTEXTSOURCE_ROOT_PATH ?? process.cwd() },
    tsconfig: { type: 'string', default: process.env.CONTEXTSOURCE_TSCONFIG },
    port: { type: 'string', default: process.env.PORT ?? '8080' },
  },
});

const db = openDatabase(path.resolve(values.db!));
const projectId = values['project-id']!;
const projectRootPath = path.resolve(values['root-path']!);

upsertProject(db, { id: projectId, name: values['project-name']!, rootPath: projectRootPath });

const app = createApp({
  db,
  projectId,
  projectName: values['project-name']!,
  projectRootPath,
  tsconfigPath: values.tsconfig ? path.resolve(values.tsconfig) : undefined,
  resolveRevision: () => currentRevision(projectRootPath),
});

const port = Number(values.port);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[contextsource-api] listening on http://localhost:${port}/api/v1 (project=${projectId}, db=${values.db})`);
});
