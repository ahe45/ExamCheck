/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { DeveloperSettingsPage } from "./DeveloperSettingsPage";

const developerSettingsApi = vi.hoisted(() => ({
  fetchHistoryResetPassword: vi.fn(),
  updateHistoryResetPassword: vi.fn(),
  changeDeveloperPassword: vi.fn(),
  fetchDeveloperSettings: vi.fn(),
  removeDeveloperLogo: vi.fn(),
  updateDeveloperSettings: vi.fn(),
  uploadDeveloperLogo: vi.fn(),
}));

vi.mock("../../shared/api/developer-settings", () => developerSettingsApi);

const initialProfile: DeveloperSettings = {
  schoolName: "한국대학교",
  academicYear: 2026,
  systemName: "가번호 관리 시스템",
  examineeNoUniqueness: "SYSTEM",
  pseudonymNoUniqueness: "ADMISSION",
  logoFileName: null,
  logoDataUrl: null,
  updatedAt: "2026-08-28T09:00:00.000Z",
};

const developerUser = {
  id: 3,
  loginId: "dev",
  role: "DEVELOPER" as const,
  admissionNames: [],
};

beforeEach(() => {
  Object.values(developerSettingsApi).forEach((mock) => mock.mockReset());
  developerSettingsApi.fetchHistoryResetPassword.mockResolvedValue({ configured: false });
  developerSettingsApi.updateHistoryResetPassword.mockResolvedValue({ configured: true });
  developerSettingsApi.fetchDeveloperSettings.mockResolvedValue({ ...initialProfile });
  developerSettingsApi.updateDeveloperSettings.mockResolvedValue({ ...initialProfile });
  developerSettingsApi.changeDeveloperPassword.mockResolvedValue({ changed: true });
  developerSettingsApi.removeDeveloperLogo.mockResolvedValue({ ...initialProfile });
  developerSettingsApi.uploadDeveloperLogo.mockResolvedValue({ ...initialProfile });
});

describe("DeveloperSettingsPage number uniqueness policy", () => {
  it("개발자 권한이 아니면 번호 유일 정책 UI와 설정 조회를 노출하지 않는다", () => {
    render(<DeveloperSettingsPage token="admin-token" user={{ ...developerUser, loginId: "admin", role: "ADMIN" }} />);

    expect(screen.queryByRole("heading", { name: "번호 유일 정책" })).not.toBeInTheDocument();
    expect(developerSettingsApi.fetchDeveloperSettings).not.toHaveBeenCalled();
  });

  it("반응형 스타일이 의존하는 시스템 정보·미리보기·정책 DOM 계층을 유지한다", async () => {
    const view = render(<DeveloperSettingsPage token="developer-token" user={developerUser} />);

    expect(await screen.findByRole("heading", { name: "시스템 기본 정보" })).toBeInTheDocument();
    expect(view.container.querySelector(".developer-settings-card > header")).toBeInTheDocument();
    expect(view.container.querySelector(".developer-profile-layout > .developer-profile-editor")).toBeInTheDocument();
    expect(view.container.querySelector(".developer-profile-layout > .developer-inline-preview")).toBeInTheDocument();
    expect(
      view.container.querySelector(".developer-profile-layout > .developer-uniqueness-section"),
    ).toBeInTheDocument();
    expect(
      view.container.querySelector(".developer-profile-editor .developer-inline-logo-section"),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "번호 유일 정책" })).toHaveAttribute("id", "developer-uniqueness-title");
  });

  it("enables save only after a policy change and sends both policies", async () => {
    let resolveSave!: (profile: DeveloperSettings) => void;
    developerSettingsApi.updateDeveloperSettings.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    render(<DeveloperSettingsPage token="developer-token" user={developerUser} />);

    const saveButton = await screen.findByRole("button", { name: "설정 저장" });
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /동일한 성명·생년월일인 수험생은 다른 날짜·교시/ }));
    fireEvent.click(screen.getByRole("radio", { name: /서로 다른 일정에서는 재사용할 수 있습니다/ }));
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);

    expect(saveButton).toBeDisabled();
    expect(screen.getByRole("group", { name: "수험번호 유일 정책" })).toBeDisabled();
    expect(screen.getByRole("group", { name: "가번호 유일 정책" })).toBeDisabled();

    await waitFor(() => {
      expect(developerSettingsApi.updateDeveloperSettings).toHaveBeenCalledWith("developer-token", {
        schoolName: "한국대학교",
        academicYear: 2026,
        systemName: "가번호 관리 시스템",
        examineeNoUniqueness: "SCHEDULE",
        pseudonymNoUniqueness: "SCHEDULE",
      });
    });
    await act(async () => {
      resolveSave({
        ...initialProfile,
        examineeNoUniqueness: "SCHEDULE",
        pseudonymNoUniqueness: "SCHEDULE",
      });
    });
    expect(await screen.findByRole("status")).toHaveTextContent("시스템 설정이 저장되었습니다.");
    expect(saveButton).toBeDisabled();
  });

  it("keeps the changed policy editable and displays a rejected save", async () => {
    developerSettingsApi.updateDeveloperSettings.mockRejectedValue(
      new Error("기존 데이터에 중복된 가번호 조합이 1개 있습니다."),
    );

    render(<DeveloperSettingsPage token="developer-token" user={developerUser} />);

    const saveButton = await screen.findByRole("button", { name: "설정 저장" });
    fireEvent.click(screen.getByRole("radio", { name: /서로 다른 일정에서는 재사용할 수 있습니다/ }));
    fireEvent.click(saveButton);

    expect(await screen.findByRole("alert")).toHaveTextContent("기존 데이터에 중복된 가번호 조합이 1개 있습니다.");
    expect(saveButton).toBeEnabled();
  });

  it("비밀번호 모달의 포커스와 body 잠금을 적용하고 ESC 종료 후 호출 버튼으로 복원한다", async () => {
    render(<DeveloperSettingsPage token="developer-token" user={developerUser} />);

    const opener = await screen.findByRole("button", { name: "비밀번호 변경" });
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole("dialog", { name: "개발자 비밀번호 변경" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "닫기" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "개발자 비밀번호 변경" })).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
    expect(document.body.style.overflow).toBe("");
  });

  it("비밀번호 저장 중에는 버튼과 ESC 종료를 비활성화하고 완료 후 다시 닫을 수 있다", async () => {
    let resolvePassword!: (result: { changed: boolean }) => void;
    developerSettingsApi.changeDeveloperPassword.mockReturnValue(
      new Promise((resolve) => {
        resolvePassword = resolve;
      }),
    );
    render(<DeveloperSettingsPage token="developer-token" user={developerUser} />);

    fireEvent.click(await screen.findByRole("button", { name: "비밀번호 변경" }));
    const dialog = screen.getByRole("dialog", { name: "개발자 비밀번호 변경" });
    fireEvent.change(within(dialog).getByLabelText("현재 비밀번호"), { target: { value: "1234" } });
    fireEvent.change(within(dialog).getByLabelText("새 비밀번호"), { target: { value: "5678" } });
    fireEvent.change(within(dialog).getByLabelText("새 비밀번호 확인"), { target: { value: "5678" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "비밀번호 변경" }));

    expect(within(dialog).getByRole("button", { name: "변경 중…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "닫기" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "개발자 비밀번호 변경" })).toBeInTheDocument();

    await act(async () => {
      resolvePassword({ changed: true });
    });
    expect(await screen.findByRole("status")).toHaveTextContent("개발자 계정 비밀번호가 변경되었습니다.");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "개발자 비밀번호 변경" })).not.toBeInTheDocument());
  });
});

it("saves a separate history reset password after matching confirmation", async () => {
  render(<DeveloperSettingsPage token="developer-token" user={developerUser} />);
  await screen.findByRole("heading", { name: "초기화 비밀번호 설정" });
  const password = screen.getByLabelText("새 초기화 비밀번호");
  const confirmation = screen.getByLabelText("초기화 비밀번호 확인");
  fireEvent.change(password, { target: { value: "new-secret" } });
  fireEvent.change(confirmation, { target: { value: "mismatch" } });
  fireEvent.click(screen.getByRole("button", { name: "비밀번호 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("일치하지");
  expect(developerSettingsApi.updateHistoryResetPassword).not.toHaveBeenCalled();
  fireEvent.change(confirmation, { target: { value: "new-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "비밀번호 저장" }));
  await waitFor(() =>
    expect(developerSettingsApi.updateHistoryResetPassword).toHaveBeenCalledExactlyOnceWith(
      "developer-token",
      "new-secret",
    ),
  );
  expect(await screen.findByText("초기화 비밀번호를 저장했습니다.")).toBeInTheDocument();
  expect(password).toHaveValue("");
  expect(confirmation).toHaveValue("");
});
