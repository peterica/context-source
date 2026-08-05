import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));

export function fixtureTsconfig(name: string): string {
  return path.join(testDir, 'fixtures', name, 'tsconfig.json');
}
