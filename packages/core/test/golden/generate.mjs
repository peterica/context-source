#!/usr/bin/env node
// golden.json을 (재)생성하는 유지보수 스크립트 — fixture를 의도적으로 바꿨을 때만 사용한다.
// `npm run build -w @contextsource/core`로 dist가 최신인 상태에서 실행해야 한다.
// 사용법: node test/golden/generate.mjs [fixture-name ...]  (인자 없으면 golden 대상 전체 재생성)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeProject } from '../../dist/index.js';
import { normalizeResult } from './normalize.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(testDir, '..', 'fixtures');

const PROJECT = 'p1';
const REV = 'rev1';

// golden 비교 대상 fixture 목록 — 여기 없는 fixture는 golden.test.ts가 "커버리지 누락"으로 실패시킨다.
const GOLDEN_FIXTURES = [
  'basic-import',
  'barrel-reexport',
  'inheritance',
  'overload-generic',
  'duplicate-symbol-names',
  'callback-hof',
  'dynamic-import',
  'external-package',
  'parse-failure',
  'dependency-injection',
];

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : GOLDEN_FIXTURES;

for (const name of targets) {
  if (!GOLDEN_FIXTURES.includes(name)) {
    console.error(`unknown golden fixture: ${name}`);
    process.exitCode = 1;
    continue;
  }
  const tsconfigPath = path.join(fixturesDir, name, 'tsconfig.json');
  const result = analyzeProject({ tsconfigPath, projectId: PROJECT, revision: REV });
  const golden = normalizeResult(result);
  const outPath = path.join(fixturesDir, name, 'golden.json');
  fs.writeFileSync(outPath, JSON.stringify(golden, null, 2) + '\n');
  console.log(
    `wrote ${path.relative(process.cwd(), outPath)} ` +
      `(${golden.entities.length} entities, ${golden.relationships.length} relationships, ${golden.failures.length} failures)`,
  );
}
