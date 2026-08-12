import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDatabase, type Db } from '../src/storage/db.js';
import { upsertProject } from '../src/storage/project-repo.js';
import { runFullAnalysis } from '../src/orchestrator.js';
import { runIncrementalAnalysis } from '../src/incremental/incremental-runner.js';
import { computeChangedImpact } from '../src/query/impact.js';
import { symbolEntityId } from '../src/id.js';

const PROJECT = 'p1';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function write(repoDir: string, relPath: string, content: string): void {
  const full = path.join(repoDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function commit(repoDir: string, message: string): string {
  git(repoDir, ['add', '-A']);
  git(repoDir, ['commit', '-q', '-m', message]);
  return git(repoDir, ['rev-parse', 'HEAD']).trim();
}

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'commonjs',
      moduleResolution: 'node',
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
    },
    include: ['src/**/*.ts', 'test/**/*.ts'],
  },
  null,
  2,
);

describe('computeChangedImpact (ADR-0008)', () => {
  let repoDir: string;

  afterAll(() => {
    if (repoDir) fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('finds direct and indirect impact candidates from a git diff, and flags a likely test file', () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-changed-impact-'));
    git(repoDir, ['init', '-q']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test']);
    write(repoDir, 'tsconfig.json', TSCONFIG);

    // c.ts (곧 바뀔 파일) <- b.ts (직접 영향) <- a.ts (간접 영향)
    write(repoDir, 'src/c.ts', `export function helperC(): number {\n  return 1;\n}\n`);
    write(
      repoDir,
      'src/b.ts',
      [
        `import { helperC } from './c';`,
        `export class B {`,
        `  method(): number {`,
        `    return helperC();`,
        `  }`,
        `}`,
        '',
      ].join('\n'),
    );
    write(
      repoDir,
      'src/a.ts',
      [`import { B } from './b';`, `export function run(): number {`, `  return new B().method();`, `}`, ''].join(
        '\n',
      ),
    );
    // test/ 아래 있고 helperC를 직접 호출하는 파일 — isLikelyTestFile 휴리스틱 확인용.
    write(
      repoDir,
      'test/c.test.ts',
      [`import { helperC } from '../src/c';`, `export function testHelperC(): number {`, `  return helperC();`, `}`, ''].join(
        '\n',
      ),
    );

    const tsconfigPath = path.join(repoDir, 'tsconfig.json');
    const projectRoot = repoDir;
    const db: Db = openDatabase(':memory:');
    upsertProject(db, { id: PROJECT, name: 'changed-impact', rootPath: repoDir, tsconfigPath });

    const revA = commit(repoDir, 'baseline');
    const full = runFullAnalysis({ db, projectId: PROJECT, tsconfigPath, revision: revA });
    expect(full.failures).toEqual([]);

    // c.ts만 바꾼다.
    write(repoDir, 'src/c.ts', `export function helperC(): number {\n  return 2; /* changed */\n}\n`);
    commit(repoDir, 'change c.ts only');

    const incr = runIncrementalAnalysis({ db, projectId: PROJECT, tsconfigPath });
    expect(incr.failures).toEqual([]);
    expect(incr.baseRevision).toBe(revA);

    const result = computeChangedImpact(db, {
      projectId: PROJECT,
      projectRoot,
      baseRevision: incr.baseRevision!,
      targetRevision: incr.revision,
      depth: 3,
      maxCandidates: 50,
    });

    const helperCId = symbolEntityId(PROJECT, 'src/c.ts', 'helperC');
    expect(result.changedEntities).toEqual([helperCId]);

    const methodId = symbolEntityId(PROJECT, 'src/b.ts', 'B.method');
    const runId = symbolEntityId(PROJECT, 'src/a.ts', 'run');
    const testId = symbolEntityId(PROJECT, 'test/c.test.ts', 'testHelperC');

    const byId = new Map(result.candidates.map((c) => [c.candidate, c]));
    expect(byId.get(methodId)?.isDirectImpact).toBe(true);
    expect(byId.get(methodId)?.changedEntityId).toBe(helperCId);
    expect(byId.get(methodId)?.isLikelyTestFile).toBe(false);

    expect(byId.get(runId)?.isDirectImpact).toBe(false);
    expect(byId.get(runId)?.path).toHaveLength(2);

    expect(byId.get(testId)?.isDirectImpact).toBe(true);
    expect(byId.get(testId)?.isLikelyTestFile).toBe(true);

    // 변경된 Entity 자신은 후보 목록에 없어야 한다.
    expect(byId.has(helperCId)).toBe(false);

    expect(result.stats.changedEntityCount).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('honors maxCandidates across merged results from multiple changed entities', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-changed-impact-multi-'));
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'Test']);
    write(dir, 'tsconfig.json', TSCONFIG);

    write(dir, 'src/x.ts', `export function x(): number {\n  return 1;\n}\n`);
    write(dir, 'src/y.ts', `export function y(): number {\n  return 1;\n}\n`);
    for (let i = 0; i < 4; i++) {
      write(
        dir,
        `src/caller${i}.ts`,
        [
          `import { x } from './x';`,
          `import { y } from './y';`,
          `export function caller${i}(): number {`,
          `  return x() + y();`,
          `}`,
          '',
        ].join('\n'),
      );
    }

    const tsconfigPath = path.join(dir, 'tsconfig.json');
    const db: Db = openDatabase(':memory:');
    upsertProject(db, { id: PROJECT, name: 'changed-impact-multi', rootPath: dir, tsconfigPath });
    const revA = commit(dir, 'baseline');
    const full = runFullAnalysis({ db, projectId: PROJECT, tsconfigPath, revision: revA });
    expect(full.failures).toEqual([]);

    write(dir, 'src/x.ts', `export function x(): number {\n  return 2; /* changed */\n}\n`);
    write(dir, 'src/y.ts', `export function y(): number {\n  return 2; /* changed */\n}\n`);
    commit(dir, 'change both x.ts and y.ts');

    const incr = runIncrementalAnalysis({ db, projectId: PROJECT, tsconfigPath });
    expect(incr.failures).toEqual([]);

    const result = computeChangedImpact(db, {
      projectId: PROJECT,
      projectRoot: dir,
      baseRevision: incr.baseRevision!,
      targetRevision: incr.revision,
      depth: 3,
      maxCandidates: 2,
    });

    expect(result.changedEntities).toHaveLength(2);
    expect(result.candidates).toHaveLength(2);
    expect(result.truncated).toBe(true);
    // caller0..3 각각 x와 y 둘 다 호출하므로 같은 후보가 두 changed entity에서 발견된다 —
    // 중복 제거되어 4개(caller0~3)만 후보여야 한다(8개가 아니라).
    const withoutTruncation = computeChangedImpact(db, {
      projectId: PROJECT,
      projectRoot: dir,
      baseRevision: incr.baseRevision!,
      targetRevision: incr.revision,
      depth: 3,
      maxCandidates: 50,
    });
    expect(withoutTruncation.candidates).toHaveLength(4);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
