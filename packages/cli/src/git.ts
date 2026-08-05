import { execFileSync } from 'node:child_process';

export function currentRevision(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return 'unversioned';
  }
}
