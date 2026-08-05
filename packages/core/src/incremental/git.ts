import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import * as path from 'node:path';

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

/** tsconfig가 있는 디렉터리를 기준으로 그 디렉터리를 포함하는 Git 저장소의 루트를 찾는다. */
export function resolveGitRoot(fromDir: string): string {
  const out = git(fromDir, ['rev-parse', '--show-toplevel']).trim();
  return realpathSync(path.resolve(out));
}

export function currentRevision(repoRoot: string): string {
  return git(repoRoot, ['rev-parse', 'HEAD']).trim();
}

export function isGitRepo(dir: string): boolean {
  try {
    git(dir, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

export interface GitDiff {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
}

/**
 * FR-A6 — base..target 사이 변경 파일 목록. 경로는 Git 저장소 루트 기준 상대 경로,
 * '/' 구분자로 정규화되어 있다 (git은 항상 '/'를 사용하므로 별도 변환 불필요).
 */
export function diffNameStatus(repoRoot: string, base: string, target: string): GitDiff {
  const out = git(repoRoot, ['diff', '--name-status', '-M', base, target]);
  const diff: GitDiff = { added: [], modified: [], deleted: [], renamed: [] };

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const statusRaw = parts[0]!;
    if (statusRaw.startsWith('R')) {
      const [, from, to] = parts;
      if (from && to) diff.renamed.push({ from, to });
      continue;
    }
    const status = statusRaw[0];
    const filePath = parts[1];
    if (!filePath) continue;
    if (status === 'A') diff.added.push(filePath);
    else if (status === 'M') diff.modified.push(filePath);
    else if (status === 'D') diff.deleted.push(filePath);
    // C(copy)/T(type-change) 등은 MVP 범위 밖 — 무시한다.
  }

  return diff;
}

/**
 * projectRoot(tsconfig 위치)가 Git 저장소 루트와 다를 때, git이 반환하는 저장소-루트 기준 경로를
 * projectRoot 기준 상대 경로로 변환한다. projectRoot 밖의 변경은 걸러낸다.
 */
export function toProjectRelative(repoRoot: string, projectRoot: string, gitRelPath: string): string | undefined {
  const abs = path.join(repoRoot, gitRelPath);
  const rel = path.relative(projectRoot, abs);
  if (rel.startsWith('..')) return undefined;
  return rel.split(path.sep).join('/');
}
