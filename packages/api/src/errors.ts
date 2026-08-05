export type ErrorCode =
  | 'INVALID_PARAM'
  | 'ENTITY_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'ANALYSIS_IN_PROGRESS';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_PARAM: 400,
  ENTITY_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  ANALYSIS_IN_PROGRESS: 409,
};

export class ApiError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export function toErrorBody(err: ApiError) {
  return { error: { code: err.code, message: err.message } };
}

const KNOWN_CODES: ErrorCode[] = [
  'INVALID_PARAM',
  'ENTITY_NOT_FOUND',
  'RUN_NOT_FOUND',
  'ANALYSIS_IN_PROGRESS',
];

/**
 * core 패키지의 orchestrator/incremental-runner는 express에 의존하지 않으므로
 * `Object.assign(new Error(...), { code })` 형태로 에러를 던진다. 여기서 ApiError로 변환한다.
 * 알려진 코드가 아니면 undefined를 반환한다(호출측이 원래 에러를 그대로 전파).
 */
export function toApiError(err: unknown): ApiError | undefined {
  if (err instanceof ApiError) return err;
  if (
    err instanceof Error &&
    'code' in err &&
    KNOWN_CODES.includes((err as { code: string }).code as ErrorCode)
  ) {
    return new ApiError((err as { code: ErrorCode }).code, err.message);
  }
  return undefined;
}
