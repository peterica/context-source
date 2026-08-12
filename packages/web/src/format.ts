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

// 변경 영향 분석(ADR-0008) 응답의 path 배열은 sourceId/targetId만 갖고 entity 이름을
// 담지 않는다(새 DTO를 만들지 않기로 한 결정) — id 자체가 DATA-MODEL.md §1의 안정된
// 스킴(`{projectId}/sym:{filePath}#{symbolPath}` 등)을 따르므로, 후보 개수만큼
// entity를 개별 조회하는 대신 id를 파싱해 짧은 표시용 라벨을 만든다.
export function entityIdLabel(id: string): string {
  const symIdx = id.indexOf('/sym:');
  if (symIdx >= 0) {
    const rest = id.slice(symIdx + '/sym:'.length);
    const hashIdx = rest.indexOf('#');
    return hashIdx >= 0 ? rest.slice(hashIdx + 1) : rest;
  }
  const extIdx = id.indexOf('/ext:');
  if (extIdx >= 0) return id.slice(extIdx + '/ext:'.length);
  const fileIdx = id.indexOf('/file:');
  if (fileIdx >= 0) return id.slice(fileIdx + '/file:'.length);
  return id;
}
