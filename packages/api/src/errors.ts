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
