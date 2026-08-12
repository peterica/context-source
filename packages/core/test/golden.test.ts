import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeProject } from '../src/analyzer/project-analyzer.js';
import { normalizeResult } from './golden/normalize.mjs';
import { fixtureTsconfig } from './helpers.js';

// BENCHMARK.md 5.4 — 골든 fixture마다 예상 Entity/Relationship/resolution/Evidence를
// golden.json으로 선언해두고, 실제 analyzeProject() 출력과 정확히 일치하는지 비교한다.
// 지금까지의 project-analyzer.test.ts는 "이 관계가 존재한다"는 개별 assertion만 했을 뿐
// "이게 전부다(그 이상도 이하도 아니다)"는 검증하지 않았다 — 이 파일은 그 완전성(누락 없음
// = recall, 초과 없음 = false positive 0)을 fixture 단위로 강제한다.

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(testDir, 'fixtures');

const PROJECT = 'p1';
const REV = 'rev1';

const allFixtureNames = fs
  .readdirSync(fixturesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const goldenFixtureNames = allFixtureNames.filter((name) =>
  fs.existsSync(path.join(fixturesDir, name, 'golden.json')),
);

describe('golden fixture regression (BENCHMARK.md 5.4)', () => {
  it('every fixture directory has a golden.json (no silently-unmeasured fixture)', () => {
    // fixture를 새로 추가하고 golden.json 생성을 깜빡하면 여기서 즉시 실패한다 —
    // "골든 fixture가 있는데 아무도 recall/false positive를 확인하지 않는" 상태를 막는다.
    expect(goldenFixtureNames).toEqual(allFixtureNames);
  });

  for (const name of goldenFixtureNames) {
    it(`${name}: entities/relationships/evidence/failures match golden.json exactly`, () => {
      const result = analyzeProject({
        tsconfigPath: fixtureTsconfig(name),
        projectId: PROJECT,
        revision: REV,
      });
      const actual = normalizeResult(result);
      const golden = JSON.parse(fs.readFileSync(path.join(fixturesDir, name, 'golden.json'), 'utf8'));
      expect(actual).toEqual(golden);
    });
  }
});
