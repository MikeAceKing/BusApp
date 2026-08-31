import { useEffect, useState } from 'react';

// BusApp has no router dependency. The public site is a handful of pages, so it uses the
// History API directly rather than pulling in a routing library for the app runtime.
export const publicPaths = ['/', '/how', '/parents', '/privacy', '/help'] as const;
export type PublicPath = typeof publicPaths[number];

export function normalizePublicPath(pathname: string): PublicPath {
  const trimmed = pathname.replace(/\/+$/, '') || '/';
  return (publicPaths as readonly string[]).includes(trimmed) ? trimmed as PublicPath : '/';
}

export function usePublicPath(): [PublicPath, (path: PublicPath) => void] {
  const [path, setPath] = useState<PublicPath>(() => normalizePublicPath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setPath(normalizePublicPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (next: PublicPath) => {
    if (window.location.pathname !== next) window.history.pushState({}, '', next);
    setPath(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  return [path, navigate];
}
