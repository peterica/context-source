// 실제 typeorm(약 28만 LOC) 전체 분석에서 UNIQUE constraint failed: entity.id로 재현된
// 패턴 3가지를 축약한 fixture다 (2026-08-12 실측 검증, BENCHMARK.md 5.11).

// 1) 같은 이름의 instance 메서드 + static 메서드 (예: TypeORM의 BaseEntity.hasId)
export class Widget {
  hasId(): boolean {
    return true;
  }

  static hasId(w: Widget): boolean {
    return w instanceof Widget;
  }
}

// 2) 같은 파일에서 이름이 같은 interface + class (선언 병합 관용구)
export interface Marker {
  readonly tag: string;
}

export class Marker {
  tag = 'x';
}

// 3) 같은 부모 함수 안, 서로 다른 형제 블록(if/else)에 있는 동명 지역 함수
export function run(flag: boolean): number {
  function helper(): number {
    if (flag) {
      function inner(): number {
        return 1;
      }
      return inner();
    } else {
      function inner(): number {
        return 2;
      }
      return inner();
    }
  }
  return helper();
}
