// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseBackupSection } from "./DatabaseBackupSection";
const mocks = vi.hoisted(() => ({ apiBlob: vi.fn(), apiFetch: vi.fn(), saveBlob: vi.fn() }));
vi.mock("../../shared/api/client", () => mocks);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("DatabaseBackupSection", () => {
  it("downloads a backup file", async () => {
    const blob = new Blob(["backup"]);
    mocks.apiBlob.mockResolvedValue({ blob });
    render(<DatabaseBackupSection token="developer-token" />);
    fireEvent.click(screen.getByRole("button", { name: "백업 다운로드" }));
    await waitFor(() =>
      expect(mocks.saveBlob).toHaveBeenCalledWith(blob, expect.stringMatching(/^examcheck-backup-.*\.json\.gz$/)),
    );
    expect(mocks.apiBlob).toHaveBeenCalledWith("/developer-settings/backup", expect.any(Object), "developer-token");
  });
  it("requires a file, password and explicit confirmation before restoring", async () => {
    mocks.apiFetch.mockResolvedValue({ restored: true });
    render(<DatabaseBackupSection token="developer-token" />);
    const restore = screen.getByRole("button", { name: "데이터 복원" });
    expect(restore).toBeDisabled();
    fireEvent.change(screen.getByLabelText("복원할 백업 파일"), {
      target: { files: [new File(["backup"], "backup.json.gz")] },
    });
    fireEvent.change(screen.getByLabelText("현재 개발자 비밀번호"), { target: { value: "password" } });
    expect(restore).toBeDisabled();
    fireEvent.change(screen.getByLabelText("확인 문구 ‘복원’ 입력"), { target: { value: "복원" } });
    expect(restore).toBeEnabled();
    fireEvent.submit(restore.closest("form")!);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());
    const [, options] = mocks.apiFetch.mock.calls[0];
    expect(options.body.get("confirmation")).toBe("복원");
    expect(options.body.get("password")).toBe("password");
    expect(await screen.findByRole("button", { name: "다시 로그인" })).toBeInTheDocument();
    expect(restore).toBeDisabled();
  });
});
