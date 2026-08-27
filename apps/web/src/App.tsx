import { lazy, Suspense, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoginPage } from "./features/auth/LoginPage";
import { useAppSession } from "./features/app-shell/useAppSession";
import { usePrinterRuntime } from "./features/app-shell/usePrinterRuntime";
import { useSystemProfile } from "./features/app-shell/useSystemProfile";
import { resolveAppRoute } from "./shared/navigation/app-routing";
import { useBrowserPath } from "./shared/navigation/use-browser-path";

const SetupPage = lazy(() => import("./features/setup/SetupPage").then((module) => ({ default: module.SetupPage })));
const OperationSchedulePage = lazy(() =>
  import("./features/candidate/OperationSchedulePage").then((module) => ({ default: module.OperationSchedulePage })),
);
const PseudonymAssignmentPage = lazy(() =>
  import("./features/candidate/PseudonymAssignmentPage").then((module) => ({
    default: module.PseudonymAssignmentPage,
  })),
);
export function App() {
  const { pathname, navigate } = useBrowserPath();
  const queryClient = useQueryClient();
  const printer = usePrinterRuntime();
  const appSession = useAppSession({
    pathname,
    navigate,
    queryCache: queryClient,
    onAuthenticationCleared: printer.resetDiagnostic,
  });
  const { systemProfile, setSystemProfile } = useSystemProfile();
  const { session, operationSchedule, restoring } = appSession;
  const resolvedRoute = useMemo(
    () => resolveAppRoute(pathname, { user: session?.user ?? null, operationSchedule }),
    [operationSchedule, pathname, session?.user],
  );

  useEffect(() => {
    if (restoring) return;
    if (pathname !== resolvedRoute.canonicalPath) navigate(resolvedRoute.canonicalPath, { replace: true });
  }, [navigate, pathname, resolvedRoute.canonicalPath, restoring]);

  if (restoring) {
    return <RouteLoading message="로그인 정보를 확인하고 있습니다." />;
  }
  if (!session || resolvedRoute.route.name === "login")
    return <LoginPage systemProfile={systemProfile} onLogin={appSession.login} />;

  return (
    <Suspense fallback={<RouteLoading message="화면을 불러오고 있습니다." />}>
      {resolvedRoute.route.name === "admin" && (
        <SetupPage
          token={session.token}
          user={session.user}
          section={resolvedRoute.route.section}
          onNavigate={navigate}
          systemProfile={systemProfile}
          onSystemProfileChange={setSystemProfile}
          onLogout={appSession.logout}
        />
      )}
      {resolvedRoute.route.name === "operation-select" && (
        <OperationSchedulePage
          token={session.token}
          user={session.user}
          systemProfile={systemProfile}
          onSelect={appSession.selectOperationSchedule}
          onLogout={appSession.logout}
        />
      )}
      {resolvedRoute.route.name === "operation" && operationSchedule && (
        <PseudonymAssignmentPage
          token={session.token}
          user={session.user}
          systemProfile={systemProfile}
          schedule={operationSchedule}
          mode={printer.mode}
          service={printer.service}
          diagnostic={printer.diagnostic}
          diagnosticBusy={printer.busy}
          onDiagnose={printer.diagnose}
          onChangeSchedule={appSession.clearOperationSchedule}
          onLogout={appSession.logout}
        />
      )}
    </Suspense>
  );
}

function RouteLoading({ message }: { message: string }) {
  return (
    <main className="loading-page">
      <div className="brand-mark">E</div>
      <p>{message}</p>
    </main>
  );
}
