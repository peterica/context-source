// ADR-0015(BENCHMARK.md 5.16 잔여분) — 실제 로깅 라이브러리(pino 등)를 추가하는 대신, 이 프로젝트가
// 필요로 하는 전부인 "grep/jq로 파싱 가능한 한 줄짜리 JSON"만 만든다. Docker의 기본 로그 드라이버가
// stdout/stderr를 그대로 남기므로, 사용자가 원하는 수집기(Loki/CloudWatch/Datadog 등)를 컨테이너
// 로그 드라이버로 붙이기만 하면 된다 — 수집기 자체는 이 프로젝트가 운영하지 않는다.

type Fields = Record<string, unknown>;

function write(stream: NodeJS.WriteStream, level: 'info' | 'error', msg: string, fields?: Fields) {
  stream.write(JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields }) + '\n');
}

export function logInfo(msg: string, fields?: Fields): void {
  write(process.stdout, 'info', msg, fields);
}

export function logError(msg: string, fields?: Fields): void {
  write(process.stderr, 'error', msg, fields);
}
