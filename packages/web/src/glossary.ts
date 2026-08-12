import type { RelationshipType, Resolution, UnresolvedReferenceReason } from '@contextsource/core';

// static/inferred, 관계 타입 같은 핵심 용어에 UI 어디에도 설명이 없어 외부 문서 없이는
// 이해하기 어려웠다(UX 감사 P1-3) — title 툴팁으로 짧은 설명을 붙인다.

export const RESOLUTION_TOOLTIP: Record<Resolution, string> = {
  static: '정적 분석(TypeChecker)으로 대상이 확정된 관계입니다. false positive가 없도록 보수적으로 판정합니다.',
  inferred:
    '제한된 규칙으로 추론한 관계로, 확신도(confidence)가 낮을 수 있습니다. 근거 코드를 함께 확인해보세요.',
};

export const REL_TYPE_TOOLTIP: Record<RelationshipType, string> = {
  DECLARES: '파일이 클래스/인터페이스/함수를 선언하는 관계',
  IMPORTS: '한 파일이 다른 파일이나 모듈을 import하는 관계',
  CALLS: '함수나 메서드가 다른 함수/메서드를 호출하는 관계',
  IMPLEMENTS: '클래스가 인터페이스를 구현하는 관계',
  EXTENDS: '클래스나 인터페이스가 다른 클래스/인터페이스를 상속하는 관계',
};

// ADR-0011 — 발견했지만 대상을 확정 못한 참조. Relationship이 아니므로 그래프에는 나타나지
// 않지만, "이 그래프가 완전하지 않을 수 있다"는 신호로 검토 탭에 노출한다.
export const UNRESOLVED_REASON_LABEL: Record<UnresolvedReferenceReason, string> = {
  'entity-not-extracted': 'Entity로 추출되지 않은 대상',
  'ambiguous-callable-type': '호출 대상이 모호함',
  'internal-path-not-in-project': '분석 범위 밖 내부 경로',
  'unresolvable-specifier': '해석할 수 없는 경로',
};

export const UNRESOLVED_REASON_TOOLTIP: Record<UnresolvedReferenceReason, string> = {
  'entity-not-extracted':
    '선언은 프로젝트 소스 안에 있지만(예: 인터페이스 멤버) Entity로 추출되지 않아 대상을 가리킬 수 없습니다.',
  'ambiguous-callable-type':
    '호출 가능한 타입의 시그니처가 0개이거나 2개 이상이라(제네릭 콜백, 유니언 타입 등) 대상을 하나로 좁힐 수 없습니다.',
  'internal-path-not-in-project':
    '모듈 경로는 해석됐지만 tsconfig include 범위 밖이라 분석 대상에 포함되지 않았습니다.',
  'unresolvable-specifier': 'import 경로 자체를 해석하지 못했습니다(경로 별칭 오류, 계산된 경로 등).',
};
