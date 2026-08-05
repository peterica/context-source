import * as path from 'node:path';
import * as ts from 'typescript';
import { packageNameFromResolvedPath, packageNameFromSpecifier } from './package-name.js';

export type ModuleResolution =
  | { kind: 'internal'; absPath: string }
  | { kind: 'external'; packageName: string }
  | { kind: 'unresolved' };

/**
 * IMPORTS target 해석 — tsconfig의 paths/baseUrl을 반영하는 ts.resolveModuleName을 사용한다 (FR-A1, OQ-11).
 */
export function resolveModuleSpecifier(
  specifierText: string,
  containingFileAbsPath: string,
  compilerOptions: ts.CompilerOptions,
  rootFileSet: ReadonlySet<string>,
): ModuleResolution {
  const result = ts.resolveModuleName(
    specifierText,
    containingFileAbsPath,
    compilerOptions,
    ts.sys,
  );
  const resolved = result.resolvedModule;

  if (!resolved) {
    if (!specifierText.startsWith('.') && !path.isAbsolute(specifierText)) {
      return { kind: 'external', packageName: packageNameFromSpecifier(specifierText) };
    }
    return { kind: 'unresolved' };
  }

  const resolvedAbsPath = path.resolve(resolved.resolvedFileName);
  const isNodeModules = resolvedAbsPath.includes(`${path.sep}node_modules${path.sep}`);

  if (resolved.isExternalLibraryImport || isNodeModules) {
    return {
      kind: 'external',
      packageName: packageNameFromResolvedPath(resolvedAbsPath, specifierText),
    };
  }

  if (rootFileSet.has(resolvedAbsPath)) {
    return { kind: 'internal', absPath: resolvedAbsPath };
  }

  // 해석은 됐지만 tsconfig include 대상 밖(d.ts 등)인 내부 파일 — 보수적으로 내부 취급.
  return { kind: 'internal', absPath: resolvedAbsPath };
}
