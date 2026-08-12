import { useEffect, useState } from 'react';

// SPA에 URL 라우팅이 전혀 없어 새로고침/뒤로가기/공유가 불가능했던 문제(UX 감사 P0-4)를
// react-router 같은 외부 의존성 없이 History API만으로 해결한다 — 이 프로젝트의 다른 화면들도
// 별도 라이브러리 없이 최소한의 코드로 상태를 관리하는 스타일을 따른다.

export type Tab = 'overview' | 'explore' | 'review' | 'history' | 'impact';
const TABS: Tab[] = ['overview', 'explore', 'review', 'history', 'impact'];

export type Route =
  | { name: 'projects' }
  | { name: 'project'; projectId: string; tab: Tab; encodedEntityId?: string };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'projects' || !parts[1]) return { name: 'projects' };

  const projectId = decodeURIComponent(parts[1]);
  const tab: Tab = TABS.includes(parts[2] as Tab) ? (parts[2] as Tab) : 'overview';
  const encodedEntityId = tab === 'explore' && parts[3] ? parts[3] : undefined;
  return { name: 'project', projectId, tab, encodedEntityId };
}

export function routeToPath(route: Route): string {
  if (route.name === 'projects') return '/';
  const base = `/projects/${encodeURIComponent(route.projectId)}/${route.tab}`;
  return route.encodedEntityId ? `${base}/${route.encodedEntityId}` : base;
}

/** pushState는 popstate를 발생시키지 않으므로, 앱 내 네비게이션에서도 리스너가 반응하도록 직접 발생시킨다. */
export function navigate(path: string): void {
  if (window.location.pathname !== path) {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return route;
}
