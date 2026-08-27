import { describe, expect, it } from "vitest";
import type { AuthUser } from "../api/auth";
import type { OperationSchedule } from "../api/examinees";
import { resolveAppRoute } from "./app-routing";

const admin: AuthUser = { id: 1, loginId: "admin", role: "ADMIN", admissionNames: [] };
const developer: AuthUser = { id: 2, loginId: "dev", role: "DEVELOPER", admissionNames: [] };
const operator: AuthUser = { id: 3, loginId: "operator", role: "OPERATOR", admissionNames: ["학생부교과"] };
const schedule: OperationSchedule = {
  date: "2026-10-30",
  time: "10:00",
  periodName: "오전",
  admissionName: "학생부교과",
  buildingNames: ["본관"],
  candidateCount: 30,
  assignedCount: 2,
};

describe("app route resolver", () => {
  it("로그인 전에는 어떤 요청 경로도 로그인 화면으로 정규화한다", () => {
    expect(resolveAppRoute("/admin/settings", { user: null, operationSchedule: null })).toEqual({
      route: { name: "login" },
      canonicalPath: "/",
    });
  });

  it("관리자는 새로고침한 관리자 메뉴를 유지하되 개발자 메뉴에는 진입하지 못한다", () => {
    expect(resolveAppRoute("/admin/templates", { user: admin, operationSchedule: null })).toEqual({
      route: { name: "admin", section: "templates" },
      canonicalPath: "/admin/templates",
    });
    expect(resolveAppRoute("/admin/developer", { user: admin, operationSchedule: null })).toEqual({
      route: { name: "admin", section: "dashboard" },
      canonicalPath: "/admin",
    });
  });

  it("개발자는 개발자 메뉴를 포함한 모든 관리자 경로를 복원한다", () => {
    expect(resolveAppRoute("/admin/developer", { user: developer, operationSchedule: null })).toEqual({
      route: { name: "admin", section: "developer" },
      canonicalPath: "/admin/developer",
    });
  });

  it("사용자는 선택된 교시 유무에 따라 선택 화면과 운영 화면으로 이동한다", () => {
    expect(resolveAppRoute("/admin", { user: operator, operationSchedule: null })).toEqual({
      route: { name: "operation-select" },
      canonicalPath: "/operation/select",
    });
    expect(resolveAppRoute("/operation/select", { user: operator, operationSchedule: schedule })).toEqual({
      route: { name: "operation" },
      canonicalPath: "/operation",
    });
  });
});
