// git revision(SHA)은 짧게 줄여 보여주지만, git 저장소가 아닌 프로젝트의 sentinel 값인
// 'unversioned'(12자)까지 무조건 10자로 자르면 'unversione'처럼 잘린 문자열이 노출된다.
export function formatRevision(revision: string): string {
  if (revision === 'unversioned') return '버전 없음';
  return revision.slice(0, 10);
}
