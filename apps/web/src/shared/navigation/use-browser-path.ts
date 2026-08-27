import { useCallback, useEffect, useState } from "react";

export interface BrowserNavigateOptions {
  replace?: boolean;
}

export type BrowserNavigate = (path: string, options?: BrowserNavigateOptions) => void;

export function useBrowserPath() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    function restoreBrowserPath() {
      setPathname(window.location.pathname);
    }

    window.addEventListener("popstate", restoreBrowserPath);
    return () => window.removeEventListener("popstate", restoreBrowserPath);
  }, []);

  const navigate = useCallback<BrowserNavigate>((path, options) => {
    if (options?.replace) window.history.replaceState({}, "", path);
    else if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setPathname(window.location.pathname);
  }, []);

  return { pathname, navigate };
}
