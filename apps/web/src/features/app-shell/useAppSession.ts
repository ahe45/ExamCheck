import { useCallback, useEffect, useState } from "react";
import { fetchCurrentUser, type Session } from "../../shared/api/auth";
import { subscribeToUnauthorized } from "../../shared/api/client";
import { fetchOperationSchedules, type OperationSchedule } from "../../shared/api/examinees";
import { resolveAppRoute } from "../../shared/navigation/app-routing";
import type { BrowserNavigate } from "../../shared/navigation/use-browser-path";
import {
  clearStoredAuthentication,
  clearStoredOperationSchedule,
  readStoredOperationSchedule,
  readStoredSession,
  writeStoredOperationSchedule,
  writeStoredSession,
} from "../../shared/session/app-session";

interface QueryCacheController {
  clear(): void;
}

interface UseAppSessionOptions {
  pathname: string;
  navigate: BrowserNavigate;
  queryCache: QueryCacheController;
  onAuthenticationCleared(): void;
}

export interface AppSessionController {
  session: Session | null;
  operationSchedule: OperationSchedule | null;
  restoring: boolean;
  login(session: Session): void;
  logout(): void;
  selectOperationSchedule(schedule: OperationSchedule): void;
  clearOperationSchedule(): void;
}

export function useAppSession({
  pathname,
  navigate,
  queryCache,
  onAuthenticationCleared,
}: UseAppSessionOptions): AppSessionController {
  const [session, setSession] = useState<Session | null>(null);
  const [operationSchedule, setOperationSchedule] = useState<OperationSchedule | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    const saved = readStoredSession(sessionStorage);
    if (!saved) {
      setRestoring(false);
      return;
    }

    let active = true;
    void fetchCurrentUser(saved.token)
      .then(async (user) => {
        if (!active) return;
        let savedSchedule = readStoredOperationSchedule(sessionStorage, user);
        if (savedSchedule && user.role !== "ADMIN" && user.role !== "DEVELOPER") {
          const storedSchedule = savedSchedule;
          try {
            const allowedSchedules = await fetchOperationSchedules(saved.token);
            savedSchedule =
              allowedSchedules.find((schedule) => sameOperationSchedule(schedule, storedSchedule)) ?? null;
          } catch {
            savedSchedule = null;
          }
          if (!active) return;
          if (savedSchedule) writeStoredOperationSchedule(sessionStorage, user.id, savedSchedule);
          else {
            clearStoredOperationSchedule(sessionStorage);
            navigate("/operation/select", { replace: true });
          }
        }
        setSession({ token: saved.token, user });
        setOperationSchedule(savedSchedule);
      })
      .catch(() => {
        clearStoredAuthentication(sessionStorage);
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  const clearAuthentication = useCallback(() => {
    clearStoredAuthentication(sessionStorage);
    setSession(null);
    setOperationSchedule(null);
    onAuthenticationCleared();
    queryCache.clear();
    navigate("/", { replace: true });
  }, [navigate, onAuthenticationCleared, queryCache]);

  useEffect(
    () =>
      subscribeToUnauthorized(() => {
        if (session) clearAuthentication();
      }),
    [clearAuthentication, session],
  );

  const login = useCallback(
    (nextSession: Session) => {
      if (session && session.user.id !== nextSession.user.id) queryCache.clear();
      writeStoredSession(sessionStorage, nextSession);
      clearStoredOperationSchedule(sessionStorage);
      setOperationSchedule(null);
      setSession(nextSession);
      const destination = resolveAppRoute(pathname, { user: nextSession.user, operationSchedule: null });
      navigate(destination.canonicalPath, { replace: true });
    },
    [navigate, pathname, queryCache, session],
  );

  const selectOperationSchedule = useCallback(
    (schedule: OperationSchedule) => {
      if (!session) return;
      writeStoredOperationSchedule(sessionStorage, session.user.id, schedule);
      setOperationSchedule(schedule);
      navigate("/operation");
    },
    [navigate, session],
  );

  const clearOperationSchedule = useCallback(() => {
    clearStoredOperationSchedule(sessionStorage);
    setOperationSchedule(null);
    navigate("/operation/select");
  }, [navigate]);

  return {
    session,
    operationSchedule,
    restoring,
    login,
    logout: clearAuthentication,
    selectOperationSchedule,
    clearOperationSchedule,
  };
}

function sameOperationSchedule(left: OperationSchedule, right: OperationSchedule) {
  return (
    left.date === right.date &&
    left.time === right.time &&
    left.periodName === right.periodName &&
    left.admissionName === right.admissionName
  );
}
