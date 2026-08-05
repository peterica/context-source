import * as path from 'node:path';

/** 비상대 import 지정자에서 패키지 이름을 추출한다 (스코프 포함, OQ-11). */
export function packageNameFromSpecifier(specifier: string): string {
  const segments = specifier.split('/');
  if (specifier.startsWith('@')) {
    return segments.slice(0, 2).join('/');
  }
  return segments[0] ?? specifier;
}

/** node_modules로 해석된 절대 경로에서 패키지 이름을 추출한다. */
export function packageNameFromResolvedPath(resolvedAbsPath: string, specifier: string): string {
  const marker = `${path.sep}node_modules${path.sep}`;
  const idx = resolvedAbsPath.lastIndexOf(marker);
  if (idx === -1) {
    return packageNameFromSpecifier(specifier);
  }
  const after = resolvedAbsPath.slice(idx + marker.length).split(path.sep);
  if (after[0]?.startsWith('@')) {
    return `${after[0]}/${after[1] ?? ''}`.replace(/\/$/, '');
  }
  return after[0] ?? packageNameFromSpecifier(specifier);
}
