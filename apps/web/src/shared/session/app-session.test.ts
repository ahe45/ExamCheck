import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser, Session } from "../api/auth";
import type { OperationSchedule } from "../api/examinees";
import {
  OPERATION_SCHEDULE_KEY,
  SESSION_KEY,
  clearStoredAuthentication,
  readStoredOperationSchedule,
  readStoredSession,
  writeStoredOperationSchedule,
  writeStoredSession,
} from "./app-session";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const user: AuthUser = { id: 7, loginId: "가번호", role: "OPERATOR", admissionNames: ["학생부교과"] };
const session: Session = { token: "valid-token", user };
const schedule: OperationSchedule = {
  date: "2026-10-30",
  time: "10:00",
  periodName: "오전",
  admissionName: "학생부교과",
  buildingNames: ["본관"],
  candidateCount: 30,
  assignedCount: 2,
};

describe("session storage validation", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("검증된 로그인 세션과 운영 교시만 복원한다", () => {
    writeStoredSession(storage, session);
    writeStoredOperationSchedule(storage, user.id, schedule);

    expect(readStoredSession(storage)).toEqual(session);
    expect(readStoredOperationSchedule(storage, user)).toEqual(schedule);
  });

  it("손상된 JSON 또는 타입이 다른 세션은 관련 선택 정보와 함께 제거한다", () => {
    storage.setItem(SESSION_KEY, "{broken");
    storage.setItem(OPERATION_SCHEDULE_KEY, JSON.stringify({ userId: user.id, schedule }));

    expect(readStoredSession(storage)).toBeNull();
    expect(storage.getItem(SESSION_KEY)).toBeNull();
    expect(storage.getItem(OPERATION_SCHEDULE_KEY)).toBeNull();

    storage.setItem(SESSION_KEY, JSON.stringify({ token: "x", user: { ...user, id: "7" } }));
    expect(readStoredSession(storage)).toBeNull();
  });

  it("다른 사용자나 배정되지 않은 전형의 저장 교시는 제거한다", () => {
    writeStoredOperationSchedule(storage, user.id + 1, schedule);
    expect(readStoredOperationSchedule(storage, user)).toBeNull();
    expect(storage.getItem(OPERATION_SCHEDULE_KEY)).toBeNull();

    writeStoredOperationSchedule(storage, user.id, { ...schedule, admissionName: "실기" });
    expect(readStoredOperationSchedule(storage, user)).toBeNull();
    expect(storage.getItem(OPERATION_SCHEDULE_KEY)).toBeNull();
  });

  it("전형 미배정 사용자는 모든 전형 교시를 복원할 수 있다", () => {
    writeStoredOperationSchedule(storage, user.id, { ...schedule, admissionName: "실기" });
    expect(readStoredOperationSchedule(storage, { ...user, admissionNames: [] })?.admissionName).toBe("실기");
  });

  it("로그아웃 시 세션과 선택 교시를 함께 제거한다", () => {
    writeStoredSession(storage, session);
    writeStoredOperationSchedule(storage, user.id, schedule);
    clearStoredAuthentication(storage);
    expect(storage.values.size).toBe(0);
  });
});
