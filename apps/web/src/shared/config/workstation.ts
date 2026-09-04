const configuredWorkstationCode = String(import.meta.env.VITE_WORKSTATION_CODE || "").trim();
const WORKSTATION_STORAGE_KEY = "examcheck.printer.workstation-code";

export const WORKSTATION_CODE = configuredWorkstationCode || "WS-DEV-001";

export function getWorkstationCode() {
  if (typeof window === "undefined") return WORKSTATION_CODE;
  try {
    return window.localStorage.getItem(WORKSTATION_STORAGE_KEY)?.trim() || WORKSTATION_CODE;
  } catch {
    return WORKSTATION_CODE;
  }
}

export function saveWorkstationCode(code: string) {
  const normalized = code.trim();
  if (!normalized) return;
  try {
    window.localStorage.setItem(WORKSTATION_STORAGE_KEY, normalized);
  } catch {
    // 저장소가 차단된 환경에서는 배포 시 지정한 워크스테이션 코드를 계속 사용합니다.
  }
}
