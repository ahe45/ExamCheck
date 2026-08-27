// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OperationScheduleMismatchModal } from "./OperationConsoleModals";

describe("operation console modal focus", () => {
  it("교시 불일치 안내가 열리면 닫기 버튼으로 포커스를 이동한다", async () => {
    const onClose = vi.fn();
    render(
      <OperationScheduleMismatchModal
        mismatch={{
          examineeNo: "1162001",
          name: "김수험",
          schedules: [
            {
              examineeNo: "1162001",
              name: "김수험",
              examDate: "2026-10-30",
              examTime: "14:00",
              periodName: "오후",
              admissionName: "학생부교과 면접",
              buildingName: "본관",
              roomName: "101호",
            },
          ],
        }}
        onClose={onClose}
      />,
    );

    const closeButton = screen.getByRole("button", { name: "교시 안내창 닫기" });
    await waitFor(() => expect(closeButton).toHaveFocus());
  });
});
