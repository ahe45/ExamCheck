// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { Session } from "./shared/api/auth";
import type { OperationSchedule } from "./shared/api/examinees";
import { OPERATION_SCHEDULE_KEY, SESSION_KEY } from "./shared/session/app-session";

const mocks = vi.hoisted(() => ({
  fetchCurrentUser: vi.fn(),
  fetchOperationSchedules: vi.fn(),
  queryClear: vi.fn(),
  fetchSystemProfile: vi.fn(async () => ({
    schoolName: "한국대학교",
    academicYear: 2026,
    systemName: "가번호 관리 시스템",
    examineeNoUniqueness: "SYSTEM",
    pseudonymNoUniqueness: "ADMISSION",
    logoFileName: null,
    logoDataUrl: null,
    updatedAt: "",
  })),
}));

const operatorSession: Session = {
  token: "operator-token",
  user: { id: 7, loginId: "가번호", role: "OPERATOR", admissionNames: ["학생부교과"] },
};
const schedule: OperationSchedule = {
  date: "2026-10-30",
  time: "10:00",
  periodName: "오전",
  admissionName: "학생부교과",
  buildingNames: ["본관"],
  candidateCount: 30,
  assignedCount: 2,
};

vi.mock("./shared/api/auth", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("./shared/api/auth")>();
  return { ...original, fetchCurrentUser: mocks.fetchCurrentUser };
});
vi.mock("./shared/api/examinees", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("./shared/api/examinees")>();
  return { ...original, fetchOperationSchedules: mocks.fetchOperationSchedules };
});
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: mocks.queryClear }),
}));
vi.mock("./shared/api/developer-settings", () => ({ fetchSystemProfile: mocks.fetchSystemProfile }));
vi.mock("./features/auth/LoginPage", () => ({
  LoginPage: ({ onLogin }: { onLogin(session: Session): void }) => (
    <button onClick={() => onLogin(operatorSession)}>로그인 화면</button>
  ),
}));
vi.mock("./features/setup/SetupPage", () => ({
  SetupPage: ({ section }: { section: string }) => <p data-testid="admin-route">관리자:{section}</p>,
}));
vi.mock("./features/candidate/OperationSchedulePage", () => ({
  OperationSchedulePage: ({ onSelect }: { onSelect(schedule: OperationSchedule): void }) => (
    <button onClick={() => onSelect(schedule)}>교시 선택 화면</button>
  ),
}));
vi.mock("./features/candidate/PseudonymAssignmentPage", () => ({
  PseudonymAssignmentPage: ({ onChangeSchedule }: { onChangeSchedule(): void }) => (
    <button onClick={onChangeSchedule}>운영 화면</button>
  ),
}));

describe("App routing shell", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
    mocks.fetchCurrentUser.mockReset();
    mocks.fetchOperationSchedules.mockReset();
    mocks.queryClear.mockReset();
  });

  it("저장된 관리자 세션과 새로고침 경로를 검증한 뒤 같은 메뉴를 복원한다", async () => {
    const session: Session = {
      token: "admin-token",
      user: { id: 1, loginId: "admin", role: "ADMIN", admissionNames: [] },
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.history.replaceState({}, "", "/admin/settings");
    mocks.fetchCurrentUser.mockResolvedValue(session.user);

    renderApp();

    expect(await screen.findByTestId("admin-route")).toHaveTextContent("관리자:settings");
    expect(window.location.pathname).toBe("/admin/settings");
  });

  it("로그인부터 교시 선택과 교시 변경까지 경로와 저장 상태를 함께 갱신한다", async () => {
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "로그인 화면" }));
    const selectButton = await screen.findByRole("button", { name: "교시 선택 화면" });
    expect(window.location.pathname).toBe("/operation/select");

    fireEvent.click(selectButton);
    const operationButton = await screen.findByRole("button", { name: "운영 화면" });
    expect(window.location.pathname).toBe("/operation");
    expect(JSON.parse(sessionStorage.getItem(OPERATION_SCHEDULE_KEY) || "null")).toMatchObject({ userId: 7, schedule });

    fireEvent.click(operationButton);
    expect(await screen.findByRole("button", { name: "교시 선택 화면" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/operation/select");
    expect(sessionStorage.getItem(OPERATION_SCHEDULE_KEY)).toBeNull();
  });

  it("새로고침 시 저장 교시가 현재 허용 목록에 없으면 운영 화면 대신 교시 선택으로 복귀한다", async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(operatorSession));
    sessionStorage.setItem(OPERATION_SCHEDULE_KEY, JSON.stringify({ userId: operatorSession.user.id, schedule }));
    window.history.replaceState({}, "", "/operation");
    mocks.fetchCurrentUser.mockResolvedValue(operatorSession.user);
    mocks.fetchOperationSchedules.mockResolvedValue([]);

    renderApp();

    expect(await screen.findByRole("button", { name: "교시 선택 화면" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/operation/select");
    expect(sessionStorage.getItem(OPERATION_SCHEDULE_KEY)).toBeNull();
  });
});

function renderApp() {
  return render(<App />);
}
