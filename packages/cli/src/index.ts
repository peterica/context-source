#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyzeProject } from '@contextsource/core';
import { currentRevision } from './git.js';

function printUsage(): void {
  console.error(
    [
      'Usage: contextsource analyze --tsconfig <path> --project-id <id> [--revision <rev>] [--out <file>]',
      '',
      'Full-scan static analysis over the project referenced by --tsconfig (FR-A7).',
      'Writes { entities, relationships, failures, analyzedFilePaths } as JSON to --out or stdout.',
    ].join('\n'),
  );
}

function runAnalyze(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      tsconfig: { type: 'string' },
      'project-id': { type: 'string' },
      revision: { type: 'string' },
      out: { type: 'string' },
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

  const result = analyzeProject({
    tsconfigPath,
    projectId: values['project-id'],
    revision,
  });

  const json = JSON.stringify(result, null, 2);
  if (values.out) {
    fs.writeFileSync(path.resolve(values.out), json);
  } else {
    process.stdout.write(json + '\n');
  }

  console.error(
    `[contextsource] entities=${result.entities.length} relationships=${result.relationships.length} ` +
      `failures=${result.failures.length} files=${result.analyzedFilePaths.length} revision=${revision}`,
  );

  if (result.failures.length > 0) {
    for (const f of result.failures) {
      console.error(`  FAILED ${f.filePath}: ${f.message}`);
    }
  }
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
