import { describe, expect, it } from "vitest";
import { createOperationCandidateState, operationCandidateReducer } from "./operation-candidate-state";

describe("operation candidate state", () => {
  it("조회 시작 시 이전 후보자와 추첨 상태를 비운다", () => {
    const state = {
      ...createOperationCandidateState(1001),
      input: "1162001",
      candidate: { examineeNo: "1162001" } as never,
      photoUrl: "blob:photo",
      drawPopoverOpen: true,
      autoDrawRemainingMs: 1200,
    };

    expect(operationCandidateReducer(state, { type: "LOOKUP_STARTED" })).toMatchObject({
      input: "1162001",
      candidate: null,
      photoUrl: null,
      searching: true,
      drawPopoverOpen: false,
      autoDrawRemainingMs: 0,
    });
  });

  it("일반 초기화는 교시 불일치 안내를 보존하고 교시 초기화는 제거한다", () => {
    const mismatch = { examineeNo: "1162002", name: "김수험", schedules: [] };
    const state = { ...createOperationCandidateState(1001), input: "1162002", scheduleMismatch: mismatch };

    expect(operationCandidateReducer(state, { type: "RESET_LOOKUP", previewNumber: 2001 })).toMatchObject({
      input: "",
      drawPreviewNumber: 2001,
      scheduleMismatch: mismatch,
    });
    expect(operationCandidateReducer(state, { type: "RESET_SCHEDULE", previewNumber: 3001 })).toMatchObject({
      input: "",
      drawPreviewNumber: 3001,
      scheduleMismatch: null,
    });
  });
});
