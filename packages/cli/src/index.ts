#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  analyzeProject,
  openDatabase,
  runFullAnalysis,
  runIncrementalAnalysis,
  upsertProject,
} from '@contextsource/core';
import { currentRevision } from './git.js';

function printUsage(): void {
  console.error(
    [
      'Usage:',
      '  contextsource analyze --tsconfig <path> --project-id <id> [--revision <rev>] [--out <file>]',
      '      Full scan, prints { entities, relationships, failures, analyzedFilePaths } as JSON (FR-A7).',
      '',
      '  contextsource analyze --tsconfig <path> --project-id <id> --db <sqlite-file> [--mode full|incremental]',
      '      Full or incremental scan persisted directly into a SQLite database (default mode: full).',
      '      Incremental mode requires a prior completed full scan in the same database (FR-A6).',
    ].join('\n'),
  );
}

function runAnalyzeToStdout(tsconfigPath: string, projectId: string, revision: string, out?: string): void {
  const result = analyzeProject({ tsconfigPath, projectId, revision });
  const json = JSON.stringify(result, null, 2);
  if (out) {
    fs.writeFileSync(path.resolve(out), json);
  } else {
    process.stdout.write(json + '\n');
  }
  console.error(
    `[contextsource] entities=${result.entities.length} relationships=${result.relationships.length} ` +
      `failures=${result.failures.length} files=${result.analyzedFilePaths.length} revision=${revision}`,
  );
  for (const f of result.failures) {
    console.error(`  FAILED ${f.filePath}: ${f.message}`);
  }
}

function runAnalyzeToDb(
  dbPath: string,
  tsconfigPath: string,
  projectId: string,
  projectRoot: string,
  mode: 'full' | 'incremental',
  revision: string,
): void {
  const db = openDatabase(path.resolve(dbPath));
  upsertProject(db, { id: projectId, name: projectId, rootPath: projectRoot });

  const run =
    mode === 'full'
      ? runFullAnalysis({ db, projectId, tsconfigPath, revision })
      : runIncrementalAnalysis({ db, projectId, tsconfigPath });

  console.error(
    `[contextsource] run=${run.id} mode=${run.mode} status=${run.status} revision=${run.revision} ` +
      `entities=${run.entityCount} relationships=${run.relationshipCount} failures=${run.failures.length}`,
  );
  for (const f of run.failures) {
    console.error(
      `  FAILED ${f.filePath}: ${f.message}${f.preservedRevision ? ` (preserved from ${f.preservedRevision})` : ''}`,
    );
  }
}

function runAnalyze(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      tsconfig: { type: 'string' },
      'project-id': { type: 'string' },
      revision: { type: 'string' },
      out: { type: 'string' },
      db: { type: 'string' },
      mode: { type: 'string' },
    },
  });

  if (!values.tsconfig || !values['project-id']) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const tsconfigPath = path.resolve(values.tsconfig);
  const projectRoot = path.dirname(tsconfigPath);
  const revision = values.revision ?? currentRevision(projectRoot);
  const projectId = values['project-id'];

  if (values.db) {
    const mode = values.mode === 'incremental' ? 'incremental' : 'full';
    runAnalyzeToDb(values.db, tsconfigPath, projectId, projectRoot, mode, revision);
    return;
  }

  runAnalyzeToStdout(tsconfigPath, projectId, revision, values.out);
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case 'analyze':
    runAnalyze(rest);
    break;
  default:
    printUsage();
    process.exitCode = command ? 1 : 0;
}
