// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateRecord } from "../../shared/api/candidates";
import { candidateColumns } from "./candidate-data-model";
import { CandidateDetailModal } from "./CandidateDetailModal";

const api = vi.hoisted(() => ({
  fetchCandidateDetail: vi.fn(),
  fetchCandidatePhoto: vi.fn(),
  updateCandidate: vi.fn(),
  saveCandidatePhoto: vi.fn(),
}));
vi.mock("../../shared/api/candidates", () => api);
const candidate = {
  ...Object.fromEntries(candidateColumns.map(({ key }) => [key, "값"])),
  id: 12,
  name: "홍길동",
  examineeNo: "001234",
  date: "2026-10-30",
  birth: "2008-01-02",
  time: "09:00",
  answerSheet: "00123456",
  updatedAt: "2026-10-21T00:00:00.000Z",
  createdAt: "2026-10-21T00:00:00.000Z",
  assignedAt: null,
  assignedNumber: null,
} as CandidateRecord;
beforeEach(() => {
  vi.clearAllMocks();
  api.fetchCandidateDetail.mockResolvedValue(candidate);
  api.fetchCandidatePhoto.mockResolvedValue(null);
  api.updateCandidate.mockResolvedValue(candidate);
  api.saveCandidatePhoto.mockResolvedValue({ saved: true });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:photo"), revokeObjectURL: vi.fn() }));
});
function setup() {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const result = render(
    <CandidateDetailModal token="token" candidate={candidate} onClose={onClose} onSaved={onSaved} />,
  );
  return { ...result, onClose, onSaved };
}
describe("candidate detail editor", () => {
  it("loads every field and saves leading-zero answer-sheet values with the concurrency snapshot", async () => {
    const { onSaved } = setup();
    await waitFor(() => expect(screen.getByLabelText("이름")).toBeEnabled());
    expect(screen.getByLabelText("답안지")).toHaveAttribute("maxLength", "8");
    expect(screen.getByLabelText("고사실명")).toBeRequired();
    expect(screen.getByLabelText("대기실명")).not.toBeRequired();
    fireEvent.change(screen.getByLabelText("답안지"), { target: { value: "00000012" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(api.updateCandidate).toHaveBeenCalledWith(
      "token",
      candidate,
      expect.objectContaining({ answerSheet: "00000012", examineeNo: "001234" }),
    );
  });
  it("keeps unsaved changes on cancel and preserves the draft when saving fails", async () => {
    const { onClose, onSaved } = setup();
    await waitFor(() => expect(screen.getByLabelText("이름")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "수정 이름" } });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("변경사항을 버릴까요");
    fireEvent.click(screen.getByRole("button", { name: "계속 수정" }));
    api.updateCandidate.mockRejectedValueOnce(new Error("다른 작업에서 수험생 정보가 변경되었습니다."));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("다른 작업에서 수험생 정보가 변경되었습니다.");
    expect(screen.getByLabelText("이름")).toHaveValue("수정 이름");
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "변경사항 버리기" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("uploads a photo to the selected record without discarding field edits", async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByLabelText("이름")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "사진 수정 중" } });
    const file = new File(["photo"], "photo.png", { type: "image/png" });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await screen.findByText("사진을 저장했습니다.");
    expect(api.saveCandidatePhoto).toHaveBeenCalledWith("token", 12, file);
    expect(screen.getByLabelText("이름")).toHaveValue("사진 수정 중");
    expect(await screen.findByAltText("사진 수정 중 수험생 사진")).toHaveAttribute("src", "blob:photo");
  });
});
