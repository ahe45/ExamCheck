// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { saveWorkstationCode } from "../config/workstation";
import { createPrintJob } from "./print-jobs";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("createPrintJob", () => {
  it("sends the client-generated idempotency UUID with the create request", async () => {
    const idempotencyKey = "5f4955d9-4625-4b24-802f-f4f19b60c422";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        idempotencyKey,
        examName: "2026년도 자격시험",
        examineeNo: "20260001",
        copies: 1,
        workstationCode: "WS-DEV-001",
      });
      return new Response(
        JSON.stringify({
          id: "job-id",
          jobNo: "PJ-1",
          status: "READY",
          copies: 1,
          format: "ZPL",
          payload: "^XA^XZ",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createPrintJob(
      "operator-token",
      "20260001",
      1,
      {
        examName: "2026년도 자격시험",
        examDate: "2026-09-12",
        examTime: "09:00",
        periodName: "1교시",
        admissionName: "학생부교과",
      },
      idempotencyKey,
    );

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer operator-token");
  });

  it("uses the workstation selected on the printer settings page", async () => {
    saveWorkstationCode("GT800-OPERATIONS");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ workstationCode: "GT800-OPERATIONS" });
      return new Response(
        JSON.stringify({
          id: "job-id",
          jobNo: "PJ-2",
          status: "READY",
          copies: 1,
          format: "ZPL",
          payload: "^XA^XZ",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await createPrintJob(
      "operator-token",
      "20260001",
      1,
      {
        examName: "2026년도 자격시험",
        examDate: "2026-09-12",
        examTime: "09:00",
        periodName: "1교시",
        admissionName: "학생부교과",
      },
      "5f4955d9-4625-4b24-802f-f4f19b60c423",
    );
  });
});
