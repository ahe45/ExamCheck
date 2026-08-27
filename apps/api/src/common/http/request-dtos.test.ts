import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { validateSync } from "class-validator";
import { describe, expect, it } from "vitest";
import { CandidateDashboardQueryDto, CandidateImportQueryDto } from "../../candidates/candidates.dto.js";
import { ExamineeNumberParamDto, OperationScheduleQueryDto } from "../../examinees/examinees.dto.js";
import { FormTemplateCodeParamDto } from "../../form-templates/form-templates.dto.js";
import {
  ExportPseudonymRosterDto,
  PseudonymOperationScopeDto,
  PseudonymSettingQueryDto,
  PseudonymSettingsOverviewQueryDto,
} from "../../pseudonyms/pseudonyms.dto.js";

describe("HTTP request DTO validation", () => {
  it("allows only the documented candidate import policies", () => {
    expect(errors(CandidateImportQueryDto, {})).toHaveLength(0);
    expect(errors(CandidateImportQueryDto, { policy: "insert-update" })).toHaveLength(0);
    expect(errors(CandidateImportQueryDto, { policy: "replace-all" as never })).not.toHaveLength(0);
  });

  it("validates aggregate read scopes before service calls", () => {
    expect(errors(CandidateDashboardQueryDto, {})).toHaveLength(0);
    expect(errors(CandidateDashboardQueryDto, { admissionName: "일반전형" })).toHaveLength(0);
    expect(errors(CandidateDashboardQueryDto, { admissionName: "x".repeat(201) })).not.toHaveLength(0);
    expect(errors(PseudonymSettingsOverviewQueryDto, { examName: "2026년도 자격시험" })).toHaveLength(0);
    expect(errors(PseudonymSettingsOverviewQueryDto, { examName: "   " })).not.toHaveLength(0);
  });

  it("validates operation schedule and examinee route values before service calls", () => {
    expect(
      errors(OperationScheduleQueryDto, {
        date: "2026-08-28",
        time: "09:30",
        periodName: "1교시",
        admissionName: "학생부교과",
      }),
    ).toHaveLength(0);
    expect(
      errors(OperationScheduleQueryDto, {
        date: "2026/08/28",
        time: "25:90",
        periodName: "",
        admissionName: "",
      }),
    ).not.toHaveLength(0);
    expect(errors(ExamineeNumberParamDto, { examineeNo: "1".repeat(51) })).not.toHaveLength(0);
    expect(
      errors(OperationScheduleQueryDto, {
        date: "2026-02-31",
        time: "09:30",
        periodName: "1교시",
        admissionName: "학생부교과",
      }),
    ).not.toHaveLength(0);
  });

  it("rejects empty setting scopes and malformed template codes", () => {
    expect(errors(PseudonymSettingQueryDto, { examName: "", admissionName: "" })).not.toHaveLength(0);
    expect(errors(FormTemplateCodeParamDto, { code: "unsafe-code" })).not.toHaveLength(0);
    expect(errors(FormTemplateCodeParamDto, { code: "ROOM_LIST" })).toHaveLength(0);
    expect(
      errors(PseudonymOperationScopeDto, {
        examName: "2026년도 자격시험",
        examDate: "2026-08-28",
        examTime: "24:00",
        periodName: "1교시",
        admissionName: "학생부교과",
      }),
    ).not.toHaveLength(0);
  });

  it("accepts only the roster export query specification and rejects the legacy client row payload", async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const scope = {
      examName: "2026년도 자격시험",
      examDate: "2026-08-28",
      examTime: "09:30",
      periodName: "1교시",
      admissionName: "학생부교과",
    };
    const metadata = { type: "body" as const, metatype: ExportPseudonymRosterDto };

    await expect(
      pipe.transform(
        {
          ...scope,
          query: {
            filters: [{ field: "status", mode: "include", values: ["등록"] }],
            sort: { field: "examineeNo", direction: "asc" },
          },
        },
        metadata,
      ),
    ).resolves.toMatchObject({ query: { filters: [{ field: "status" }] } });
    await expect(pipe.transform({ ...scope, rows: [] }, metadata)).rejects.toThrow();
    await expect(
      pipe.transform(
        {
          ...scope,
          query: { filters: [{ field: "password", mode: "include", values: ["secret"] }] },
        },
        metadata,
      ),
    ).rejects.toThrow();
  });
});

type Constructor<T extends object> = new () => T;

function errors<T extends object>(Type: Constructor<T>, values: Partial<T>) {
  return validateSync(Object.assign(new Type(), values));
}
