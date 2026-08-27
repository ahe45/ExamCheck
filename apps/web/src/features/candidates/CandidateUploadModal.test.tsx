/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../shared/api/client";
import { CandidateUploadModal } from "./CandidateUploadModal";

const candidatesApi = vi.hoisted(() => ({
  downloadCandidateTemplate: vi.fn(),
  importCandidatePhotoArchive: vi.fn(),
  importCandidateWorkbook: vi.fn(),
  previewCandidatePhotoArchive: vi.fn(),
  previewCandidateWorkbook: vi.fn(),
}));

vi.mock("../../shared/api/candidates", () => candidatesApi);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CandidateUploadModal", () => {
  it("shows a wrong file type error inside the workbook preview and keeps upload disabled", () => {
    const { container } = renderModal();

    chooseFile(container, new File(["not-xlsx"], "wrong.csv", { type: "text/csv" }), ".xlsx");

    expect(screen.getByRole("alert")).toHaveTextContent("XLSX 형식의 수험생 업로드 양식을 선택해 주세요.");
    expect(screen.getByRole("alert")).toHaveClass("candidate-upload-preview-error");
    expect(screen.getByRole("button", { name: "업로드 실행" })).toBeDisabled();
    expect(candidatesApi.previewCandidateWorkbook).not.toHaveBeenCalled();
  });

  it("turns a rejected workbook preview into the upload-format guide in the preview section", async () => {
    candidatesApi.previewCandidateWorkbook.mockRejectedValue(
      new ApiError("필수 컬럼이 일치하지 않습니다.", 400, "VALIDATION_ERROR"),
    );
    const { container } = renderModal();

    chooseFile(container, new File(["PK"], "different.xlsx"), ".xlsx");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("선택한 파일이 수험생 업로드 양식과 일치하지 않습니다.");
    expect(alert).toHaveTextContent("필수 컬럼이 일치하지 않습니다.");
    expect(alert.closest(".candidate-upload-preview")).not.toBeNull();
    expect(screen.getByRole("button", { name: "업로드 실행" })).toBeDisabled();
  });

  it("keeps an invalid server response message separate from workbook-format guidance", async () => {
    candidatesApi.previewCandidateWorkbook.mockRejectedValue(
      new ApiError("서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.", 502, "INVALID_RESPONSE"),
    );
    const { container } = renderModal();

    chooseFile(container, new File(["PK"], "upload.xlsx"), ".xlsx");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    expect(alert).not.toHaveTextContent("선택한 파일이 수험생 업로드 양식과 일치하지 않습니다.");
    expect(screen.getByRole("button", { name: "업로드 실행" })).toBeDisabled();
  });

  it("enables upload only after a valid preview and completes the workbook import", async () => {
    candidatesApi.previewCandidateWorkbook.mockResolvedValue({
      fileName: "수험생 업로드 양식.xlsx",
      previewToken: "signed-preview-token",
      totalRows: 3,
      insertCount: 2,
      updateCount: 1,
      unchangedCount: 0,
    });
    candidatesApi.importCandidateWorkbook.mockResolvedValue({ inserted: 2, updated: 1, skipped: 0 });
    const onClose = vi.fn();
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onClose, onComplete });
    const file = new File(["PK"], "수험생 업로드 양식.xlsx");

    chooseFile(container, file, ".xlsx");

    expect(await screen.findByText("총 3건")).toBeInTheDocument();
    const uploadButton = screen.getByRole("button", { name: "업로드 실행" });
    expect(uploadButton).toBeEnabled();
    fireEvent.click(uploadButton);

    await waitFor(() => {
      expect(candidatesApi.importCandidateWorkbook).toHaveBeenCalledWith(
        "token",
        file,
        "insert-update",
        "signed-preview-token",
      );
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith("수험생 데이터 3건을 저장했습니다. 신규 2건 · 수정 1건 · 건너뜀 0건");
  });

  it("commits the exact photo archive preview ticket", async () => {
    candidatesApi.previewCandidatePhotoArchive.mockResolvedValue({
      fileName: "수험생 사진.zip",
      previewToken: "signed-photo-preview-token",
      totalFiles: 2,
      matchedCount: 2,
      skippedCount: 0,
      duplicateCount: 0,
    });
    candidatesApi.importCandidatePhotoArchive.mockResolvedValue({
      totalFiles: 2,
      uploaded: 2,
      updated: 0,
      skipped: 0,
      duplicateCount: 0,
    });
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onComplete });
    fireEvent.click(screen.getByRole("button", { name: "수험생 사진" }));
    const archive = new File(["PK"], "수험생 사진.zip");

    chooseFile(container, archive, ".zip,application/zip");
    expect(await screen.findByText("수험생 사진 미리보기")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "업로드 실행" }));

    await waitFor(() => {
      expect(candidatesApi.importCandidatePhotoArchive).toHaveBeenCalledWith(
        "token",
        archive,
        "insert-update",
        "signed-photo-preview-token",
      );
    });
    expect(onComplete).toHaveBeenCalledWith("수험생 사진 2건을 저장했습니다. 신규 2건 · 교체 0건 · 건너뜀 0건");
  });

  it("closes with Escape while idle and ignores Escape while previewing", async () => {
    const idleClose = vi.fn();
    const idle = renderModal({ onClose: idleClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(idleClose).toHaveBeenCalledOnce();
    idle.unmount();

    let resolvePreview: ((value: unknown) => void) | undefined;
    candidatesApi.previewCandidateWorkbook.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    const busyClose = vi.fn();
    const busy = renderModal({ onClose: busyClose });
    chooseFile(busy.container, new File(["PK"], "upload.xlsx"), ".xlsx");
    expect(await screen.findByRole("status")).toHaveTextContent("업로드 파일을 확인하고 있습니다.");
    expect(busy.container.querySelector('input[type="file"]')).toBeDisabled();
    expect(screen.getByRole("button", { name: "수험생 사진" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /신규 \+ 수정 반영/ })).toBeDisabled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(busyClose).not.toHaveBeenCalled();

    resolvePreview?.({
      fileName: "upload.xlsx",
      previewToken: "signed-preview-token",
      totalRows: 1,
      insertCount: 1,
      updateCount: 0,
      unchangedCount: 0,
    });
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});

function renderModal(overrides: Partial<ComponentProps<typeof CandidateUploadModal>> = {}) {
  return render(
    <CandidateUploadModal
      open
      token="token"
      onClose={() => undefined}
      onComplete={async () => undefined}
      {...overrides}
    />,
  );
}

function chooseFile(container: HTMLElement, file: File, accept: string) {
  const input = container.querySelector<HTMLInputElement>(`input[type="file"][accept="${accept}"]`);
  if (!input) throw new Error(`File input ${accept} not found.`);
  fireEvent.change(input, { target: { files: [file] } });
}
