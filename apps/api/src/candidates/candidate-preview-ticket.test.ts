import { describe, expect, it } from "vitest";
import {
  assertCandidatePreviewState,
  candidatePhotoStateChecksum,
  candidateWorkbookStateChecksum,
  CandidatePreviewTicketError,
  createCandidatePreviewTicket,
  verifyCandidatePreviewTicket,
} from "./candidate-preview-ticket.js";

const secret = "candidate-preview-ticket-test-secret";
const now = 1_800_000_000_000;
const fileChecksum = "a".repeat(64);
const stateChecksum = "b".repeat(64);

describe("candidate preview tickets", () => {
  it("binds a signed ticket to its user, upload kind, file, state, and expiry", () => {
    const token = createCandidatePreviewTicket(
      { version: 1, kind: "WORKBOOK", actorUserId: 7, fileChecksum, stateChecksum, expiresAt: now + 60_000 },
      secret,
    );

    expect(
      verifyCandidatePreviewTicket(token, { kind: "WORKBOOK", actorUserId: 7, fileChecksum, now }, secret),
    ).toMatchObject({ stateChecksum, expiresAt: now + 60_000 });
    expect(() =>
      verifyCandidatePreviewTicket(token, { kind: "WORKBOOK", actorUserId: 8, fileChecksum, now }, secret),
    ).toThrow(CandidatePreviewTicketError);
    expect(() =>
      verifyCandidatePreviewTicket(token, { kind: "PHOTO_ARCHIVE", actorUserId: 7, fileChecksum, now }, secret),
    ).toThrow(CandidatePreviewTicketError);
  });

  it("rejects tampering, a changed file, and an expired ticket without exposing payload data", () => {
    const token = createCandidatePreviewTicket(
      { version: 1, kind: "WORKBOOK", actorUserId: 7, fileChecksum, stateChecksum, expiresAt: now + 1 },
      secret,
    );

    expect(() =>
      verifyCandidatePreviewTicket(`${token}x`, { kind: "WORKBOOK", actorUserId: 7, fileChecksum, now }, secret),
    ).toThrow("INVALID");
    expect(() =>
      verifyCandidatePreviewTicket(
        token,
        { kind: "WORKBOOK", actorUserId: 7, fileChecksum: "c".repeat(64), now },
        secret,
      ),
    ).toThrow("FILE_CHANGED");
    expect(() =>
      verifyCandidatePreviewTicket(token, { kind: "WORKBOOK", actorUserId: 7, fileChecksum, now: now + 1 }, secret),
    ).toThrow("EXPIRED");
  });

  it("creates deterministic state checksums and rejects a stale preview", () => {
    const workbookBefore = candidateWorkbookStateChecksum(
      [
        { id: 2, updatedAt: new Date("2026-01-02T00:00:00.000Z") },
        { id: 1, updatedAt: new Date("2026-01-01T00:00:00.000Z") },
      ],
      secret,
    );
    const workbookSame = candidateWorkbookStateChecksum(
      [
        { id: 1, updatedAt: new Date("2026-01-01T00:00:00.000Z") },
        { id: 2, updatedAt: new Date("2026-01-02T00:00:00.000Z") },
      ],
      secret,
    );
    const photoBefore = candidatePhotoStateChecksum(
      [
        { id: 1, examineeNo: "masked", photoHash: null },
        { id: 2, examineeNo: "masked", photoHash: "hash" },
      ],
      secret,
    );
    const photoAfter = candidatePhotoStateChecksum(
      [
        { id: 1, examineeNo: "masked", photoHash: "changed" },
        { id: 2, examineeNo: "masked", photoHash: "hash" },
      ],
      secret,
    );

    expect(workbookBefore).toBe(workbookSame);
    expect(candidateWorkbookStateChecksum([], secret, "SYSTEM")).not.toBe(
      candidateWorkbookStateChecksum([], secret, "SCHEDULE"),
    );
    expect(photoBefore).not.toBe(photoAfter);
    expect(() => assertCandidatePreviewState(photoBefore, photoAfter)).toThrow("STATE_CHANGED");
  });
});
