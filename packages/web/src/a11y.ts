import type { KeyboardEvent } from 'react';

// onClick만 있고 role/tabIndex/키보드 핸들러가 없는 tr/div/a는 마우스로만 도달할 수 있고
// Tab으로는 절대 포커스되지 않았다(접근성 감사 — 실제 Tab 키 순회로 확인, BENCHMARK.md 5.20).
// 목록 행처럼 "버튼 역할을 하는 비-버튼 요소"에 공통으로 적용해 Tab으로 포커스하고
// Enter/Space로 활성화할 수 있게 한다.
export function clickableRowProps(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
