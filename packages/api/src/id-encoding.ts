// API.md §1.1 — HTTP path의 {id}는 canonical id를 UTF-8 바이트로 변환한 뒤
// padding 없는 Base64url(RFC 4648 URL-safe alphabet)로 인코딩한 encodedId를 사용한다.

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export function encodeEntityId(canonicalId: string): string {
  return Buffer.from(canonicalId, 'utf8').toString('base64url');
}

/** 잘못된 Base64url이면 undefined를 반환한다 (호출측이 400 INVALID_PARAM으로 매핑). */
export function decodeEntityId(encodedId: string): string | undefined {
  if (!BASE64URL_RE.test(encodedId)) return undefined;
  try {
    const decoded = Buffer.from(encodedId, 'base64url').toString('utf8');
    // 왕복 인코딩이 원본과 일치해야 유효한 base64url로 간주한다.
    if (encodeEntityId(decoded) !== encodedId) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}
