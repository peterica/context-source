// git revision(SHA)은 짧게 줄여 보여주지만, git 저장소가 아닌 프로젝트의 sentinel 값인
// 'unversioned'(12자)까지 무조건 10자로 자르면 'unversione'처럼 잘린 문자열이 노출된다.
export function formatRevision(revision: string): string {
  if (revision === 'unversioned') return '버전 없음';
  return revision.slice(0, 10);
}

// Entity.kind는 raw enum 값(예: 'external_module')이라 화면마다 그대로 노출하면
// 표기가 뒤섞인다(UX 감사 P1-6) — 모든 화면이 이 하나의 라벨을 공유한다.
import type { EntityKind } from '@contextsource/core';

export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  file: 'File',
  class: 'Class',
  interface: 'Interface',
  function: 'Function',
  method: 'Method',
  external_module: 'External Module',
};
