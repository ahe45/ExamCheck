// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CandidateUploadModal } from "../candidates/CandidateUploadModal";
import { AccountEditorModal } from "./AccountEditorModal";

function CandidateUploadHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>수험생 업로드 열기</button>
      <CandidateUploadModal
        open={open}
        token="token"
        onClose={() => setOpen(false)}
        onComplete={async () => undefined}
      />
    </>
  );
}

function AccountEditorHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>계정 생성 열기</button>
      {open && (
        <AccountEditorModal
          admissions={["학생부교과 면접"]}
          editing={null}
          onClose={() => setOpen(false)}
          onSave={async () => true}
          onValidationError={vi.fn()}
        />
      )}
    </>
  );
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("admin dialog focus integration", () => {
  it("수험생 업로드 모달을 ESC로 닫고 호출 버튼에 포커스를 돌려준다", async () => {
    render(<CandidateUploadHarness />);
    const opener = screen.getByRole("button", { name: "수험생 업로드 열기" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "데이터 업로드" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "닫기" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "데이터 업로드" })).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("계정 편집 모달을 ESC로 닫고 호출 버튼에 포커스를 돌려준다", async () => {
    render(<AccountEditorHarness />);
    const opener = screen.getByRole("button", { name: "계정 생성 열기" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "계정 생성" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "닫기" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "계정 생성" })).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
