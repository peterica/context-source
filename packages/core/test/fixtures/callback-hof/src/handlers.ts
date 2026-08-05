export function onClick(): void {
  console.log('clicked');
}

// 매개변수로 전달된 콜백을 지역 변수에 대입 후 호출한다.
// 호출 시점에는 어떤 함수가 전달됐는지 정적으로 알 수 없으므로 관계를 생성하지 않는다.
export function registerHandler(run: () => void): void {
  const handler = run;
  handler();
}

export function greet(): string {
  return 'hi';
}

// 알려진 함수를 그대로 지역 변수에 대입한 뒤 호출 — 타입의 호출 시그니처를 통해
// greet으로 역추적할 수 있으므로 inferred로 기록된다.
export function invoke(): string {
  const fn = greet;
  return fn();
}
