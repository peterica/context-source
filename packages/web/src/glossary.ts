import type { RelationshipType, Resolution } from '@contextsource/core';

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
