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
  it("shows a wrong file type error in a toast and keeps upload disabled", () => {
    const { container } = renderModal();

    chooseFile(container, new File(["not-xlsx"], "wrong.csv", { type: "text/csv" }), ".xlsx");

    expect(screen.getByRole("alert")).toHaveTextContent("XLSX 형식의 수험생 업로드 양식을 선택해 주세요.");
    expect(screen.getByRole("alert").closest("[data-app-toast-viewport]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "업로드 실행" })).toBeDisabled();
    expect(candidatesApi.previewCandidateWorkbook).not.toHaveBeenCalled();
  });

  it("shows the upload-format guide in a toast when workbook preview fails", async () => {
    candidatesApi.previewCandidateWorkbook.mockRejectedValue(
      new ApiError("필수 컬럼이 일치하지 않습니다.", 400, "VALIDATION_ERROR"),
    );
    const { container } = renderModal();

    chooseFile(container, new File(["PK"], "different.xlsx"), ".xlsx");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("선택한 파일이 수험생 업로드 양식과 일치하지 않습니다.");
    expect(alert).toHaveTextContent("필수 컬럼이 일치하지 않습니다.");
    expect(alert.closest("[data-app-toast-viewport]")).not.toBeNull();
    expect(alert.closest("[inert]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "알림 닫기" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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

  it.each(["picker", "drop"])("previews and imports the exact workbook from %s", async (method) => {
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

    if (method === "drop") dropFiles(container, [file]);
    else chooseFile(container, file, ".xlsx");

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

  it.each(["picker", "drop"])("commits the exact photo archive preview ticket from %s", async (method) => {
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

    if (method === "drop") dropFiles(container, [archive]);
    else chooseFile(container, archive, ".zip,application/zip");
    expect(await screen.findByText("총 2개")).toBeInTheDocument();
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

    dropFiles(busy.container, [new File(["PK"], "another.xlsx")]);
    expect(candidatesApi.previewCandidateWorkbook).toHaveBeenCalledTimes(1);

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

  it.each([
    ["수험생 데이터", "wrong.zip", "XLSX 형식"],
    ["수험생 사진", "wrong.xlsx", "ZIP 형식"],
  ])("rejects wrong file types dropped on %s", (tab, fileName, message) => {
    const { container } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: tab }));
    dropFiles(container, [new File(["PK"], fileName)]);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "업로드 실행" })).toBeDisabled();
    expect(candidatesApi.previewCandidateWorkbook).not.toHaveBeenCalled();
    expect(candidatesApi.previewCandidatePhotoArchive).not.toHaveBeenCalled();
  });

  it("rejects a multiple-file drop and clears the previous preview", async () => {
    candidatesApi.previewCandidateWorkbook.mockResolvedValue({
      fileName: "first.xlsx",
      previewToken: "preview-token",
      totalRows: 1,
      insertCount: 1,
      updateCount: 0,
      unchangedCount: 0,
    });
    const { container } = renderModal();
    const first = new File(["PK"], "first.xlsx");
    dropFiles(container, [first]);
    await waitFor(() => expect(screen.getByRole("button", { name: "업로드 실행" })).toBeEnabled());
    dropFiles(container, [first, new File(["PK"], "second.xlsx")]);
    expect(screen.getByRole("alert")).toHaveTextContent("한 번에 파일 한 개만 선택해 주세요.");
    expect(screen.getByRole("button", { name: "업로드 실행" })).toBeDisabled();
    expect(screen.queryByText("총 1건")).not.toBeInTheDocument();
    expect(candidatesApi.previewCandidateWorkbook).toHaveBeenCalledTimes(1);
  });

  it("keeps drag feedback across child elements and clears it when leaving the panel", () => {
    const { container } = renderModal();
    const panel = container.querySelector(".candidate-upload-file-panel")!;
    const label = panel.querySelector("label")!;
    const dataTransfer = { types: ["Files"], files: [] };
    fireEvent.dragEnter(panel, { dataTransfer });
    fireEvent.dragEnter(label, { dataTransfer });
    fireEvent.dragLeave(label, { dataTransfer });
    expect(panel).toHaveClass("is-dragging");
    expect(screen.getByText("여기에 파일을 놓아 주세요")).toBeInTheDocument();
    fireEvent.dragLeave(panel, { dataTransfer });
    expect(panel).not.toHaveClass("is-dragging");
    expect(screen.getByText("XLSX 파일 선택 또는 끌어다 놓기")).toBeInTheDocument();
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

function dropFiles(container: HTMLElement, files: File[]) {
  const panel = container.querySelector(".candidate-upload-file-panel");
  if (!panel) throw new Error("File drop panel not found.");
  fireEvent.drop(panel, { dataTransfer: { files, types: ["Files"] } });
}
