export async function load(): Promise<unknown> {
  return import('./lazy');
}

export async function loadDynamic(pathVar: string): Promise<unknown> {
  // 계산된 경로 — 정적으로 대상을 특정할 수 없어 관계를 생성하지 않는다.
  return import(pathVar);
}
