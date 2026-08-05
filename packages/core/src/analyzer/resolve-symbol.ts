import * as ts from 'typescript';

/**
 * 심볼의 선언 노드를 찾는다. import alias는 원래 선언까지 따라간다.
 * 함수/메서드는 valueDeclaration(구현 시그니처)을 우선한다 (오버로드는 항상 구현 노드로 귀결, ADR-0002 §2).
 */
export function resolveDeclarationNode(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Node | undefined {
  let s = symbol;
  // barrel re-export처럼 alias가 여러 단계로 이어질 수 있어 더 이상 alias가 아닐 때까지 따라간다.
  for (let hop = 0; hop < 10 && s.flags & ts.SymbolFlags.Alias; hop++) {
    let next: ts.Symbol;
    try {
      next = checker.getAliasedSymbol(s);
    } catch {
      break;
    }
    if (next === s) break;
    s = next;
  }
  // 오버로드가 있으면 symbol.valueDeclaration이 body 없는 첫 시그니처를 가리킬 수 있으므로
  // (구현 TS 버전에 따라 달라짐), declarations 중 body가 있는 구현 노드를 최우선으로 찾는다.
  const decls = s.declarations;
  if (decls && decls.length > 0) {
    const withBody = decls.find(
      (d) => (ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d)) && d.body,
    );
    if (withBody) return withBody;
  }
  if (s.valueDeclaration) return s.valueDeclaration;
  if (decls && decls.length > 0) {
    const preferred =
      decls.find((d) => ts.isClassDeclaration(d)) ??
      decls.find((d) => ts.isInterfaceDeclaration(d)) ??
      decls.find((d) => ts.isVariableDeclaration(d));
    return preferred ?? decls[0];
  }
  return undefined;
}
