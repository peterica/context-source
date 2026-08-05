import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

export interface LoadedProgram {
  program: ts.Program;
  checker: ts.TypeChecker;
  /** tsconfig.json이 위치한 디렉터리(프로젝트 루트) — 절대 경로 */
  projectRoot: string;
  /** tsconfig의 include/exclude 반영 후 컴파일 대상이 된 절대 경로 목록 (선언 파일 제외) */
  rootFileNames: string[];
}

/**
 * 사용자가 지정한 tsconfig.json을 진입점으로 Program/TypeChecker를 구성한다 (FR-A1).
 * include/exclude/paths/baseUrl은 ts.parseJsonConfigFileContent가 그대로 반영한다.
 */
export function loadProgram(tsconfigPath: string): LoadedProgram {
  const absTsconfigPath = path.resolve(tsconfigPath);
  if (!fs.existsSync(absTsconfigPath)) {
    throw new Error(`tsconfig not found: ${absTsconfigPath}`);
  }
  const configFile = ts.readConfigFile(absTsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`,
    );
  }

  const projectRoot = path.dirname(absTsconfigPath);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);
  if (parsed.errors.length > 0) {
    const msg = parsed.errors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('\n');
    throw new Error(`Invalid tsconfig: ${msg}`);
  }

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
  const checker = program.getTypeChecker();

  const rootFileNames = parsed.fileNames.map((f) => path.resolve(f));

  return { program, checker, projectRoot, rootFileNames };
}

export function toProjectRelativePath(projectRoot: string, absPath: string): string {
  const rel = path.relative(projectRoot, absPath);
  return rel.split(path.sep).join('/');
}
