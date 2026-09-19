import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { fetchExamineePhoto, type OperationSchedule } from "../../shared/api/examinees";
import type { FormTemplate } from "../../shared/api/form-templates";
import { boundedMap, isAbortError, throwIfAborted } from "../../shared/async/bounded-map";
import { getTemplateDocumentHtml, renderTemplateHtml } from "../templates/template-renderer";
import {
  getPrintableCandidateGrid,
  renderCandidateGridPages,
  sortCandidateGridRecords,
} from "../templates/template-candidate-pages";
import { emptyTemplateSignatureNames, type TemplateSignatureNames } from "../templates/template-signatures";
import { operationRowAttendance, type OperationGridContext, type OperationRow } from "./operation-view-model";

export type OperationPrintTarget = "ALL" | "PRESENT";

export function selectOperationPrintRows(
  rows: OperationRow[],
  target: OperationPrintTarget,
  context: OperationGridContext,
) {
  return target === "PRESENT" ? rows.filter((row) => operationRowAttendance(row, context) === "응시") : rows;
}

export interface OperationTemplateContext {
  token: string;
  systemProfile: DeveloperSettings;
  schedule: OperationSchedule;
  examName: string;
  operationClosed: boolean;
  labelPrintingEnabled?: boolean;
  printTarget?: OperationPrintTarget;
  signatureNames?: TemplateSignatureNames;
  signal?: AbortSignal;
  onPhotoProgress?(completed: number, total: number): void;
}

export async function buildOperationTemplatePages(
  template: FormTemplate,
  sourceRows: OperationRow[],
  context: OperationTemplateContext,
) {
  const pages = createOperationTemplatePages(template, sourceRows, context);
  return boundedMap(
    Array.from({ length: pages.length }, (_, i) => i),
    (i) => pages.getPage(i),
    {
      concurrency: 4,
      signal: context.signal,
    },
  );
}

// Keep only the current page's photos and HTML alive during production PDF generation.
export function createOperationTemplatePages(
  template: FormTemplate,
  sourceRows: OperationRow[],
  context: OperationTemplateContext,
) {
  throwIfAborted(context.signal);
  const attendanceContext = {
    operationClosed: context.operationClosed,
    labelPrintingEnabled: context.labelPrintingEnabled ?? context.schedule.labelPrintingEnabled ?? false,
  };
  const rows = selectOperationPrintRows(sourceRows, context.printTarget || "ALL", attendanceContext);
  if (!rows.length)
    throw new Error(
      context.printTarget === "PRESENT"
        ? "응시한 수험생이 없어 출력할 수 없습니다."
        : "PDF로 생성할 수험생 데이터가 없습니다.",
    );
  const statistics = new Map<OperationRow, { total: number; present: number; absent: number }>();
  for (const group of template.usageScope === "ROOM" ? groupByRoom(sourceRows) : [sourceRows]) {
    const counts = { total: group.length, present: 0, absent: 0 };
    for (const row of group) {
      const attendance = operationRowAttendance(row, attendanceContext);
      counts.present += Number(attendance === "응시");
      counts.absent += Number(attendance === "결시");
      statistics.set(row, counts);
    }
  }
  const printedAt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const valuesFor = (row: OperationRow, index: number, photo = "") =>
    templateValues(row, statistics.get(row)!, index, context, photo, printedAt);
  const requiresPhoto = getTemplateDocumentHtml(template.layout).includes("candidate.photo");
  const grid = getPrintableCandidateGrid(template.layout);
  const groups = template.usageScope === "ROOM" ? groupByRoom(rows) : [rows];
  const pageRows: OperationRow[][] = [];
  if (grid) {
    for (const group of groups) {
      const sorted = sortCandidateGridRecords(
        grid,
        group.map((row) => ({ ...valuesFor(row, 0), row })),
      );
      for (let i = 0; i < sorted.length; i += grid.capacity)
        pageRows.push(sorted.slice(i, i + grid.capacity).map((item) => item.row));
    }
  } else if (template.usageScope === "CANDIDATE") rows.forEach((row) => pageRows.push([row]));
  else pageRows.push(...groups);
  let completed = 0;
  return {
    length: pageRows.length,
    async getPage(index: number): Promise<string> {
      throwIfAborted(context.signal);
      const group = pageRows[index];
      if (!group) throw new Error("출력 페이지를 찾을 수 없습니다.");
      const items = grid ? group : [group[0]];
      const values = await boundedMap(
        items,
        async (row, slot) => {
          const withPhoto = requiresPhoto && (Boolean(grid) || template.usageScope === "CANDIDATE");
          const photo = withPhoto ? await candidatePhoto(row, context) : "";
          if (withPhoto) context.onPhotoProgress?.(++completed, rows.length);
          return valuesFor(row, grid ? slot : index, photo);
        },
        { concurrency: 4, signal: context.signal },
      );
      throwIfAborted(context.signal);
      return grid ? renderCandidateGridPages(grid, values)[0] : renderTemplateHtml(template.layout, values[0]);
    },
  };
}

function groupByRoom(rows: OperationRow[]) {
  const groups = new Map<string, OperationRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.candidate.buildingName, row.candidate.roomName]);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function candidatePhoto(row: OperationRow, context: OperationTemplateContext) {
  throwIfAborted(context.signal);
  const blob = await fetchExamineePhoto(
    row.candidate.examineeNo,
    context.token,
    context.schedule,
    context.signal,
  ).catch((reason: unknown) => {
    if (isAbortError(reason)) throw reason;
    return null;
  });
  return blob ? blobToDataUrl(blob, context.signal) : "";
}

function templateValues(
  row: OperationRow | undefined,
  counts: { total: number; present: number; absent: number },
  index: number,
  context: OperationTemplateContext,
  photo: string,
  printedAt: string,
) {
  const candidate = row?.candidate;
  const assignment = row?.assignment;
  const attendanceContext = {
    operationClosed: context.operationClosed,
    labelPrintingEnabled: context.labelPrintingEnabled ?? context.schedule.labelPrintingEnabled ?? false,
  };
  return {
    ...emptyTemplateSignatureNames(),
    ...(context.signatureNames || {}),
    "system.title": context.systemProfile.systemName,
    "system.printedAt": printedAt,
    "school.code": "",
    "school.name": context.systemProfile.schoolName,
    "candidate.examNo": candidate?.examineeNo || "",
    "candidate.name": candidate?.name || "",
    "candidate.birthDate": candidate?.birthDate || "",
    "candidate.temporaryNo": assignment?.pseudonymNumber || "",
    "candidate.preassignedNo": candidate?.preassignedNumber || "",
    "candidate.examName": candidate?.examName || context.examName,
    "candidate.examDate": candidate?.examDate || context.schedule.date,
    "candidate.examStartTime": candidate?.examTime || context.schedule.time,
    "candidate.examEndTime": candidate?.examEndTime || "",
    "candidate.admissionYear": String(context.systemProfile.academicYear),
    "candidate.applicationTypeCode": "",
    "candidate.applicationTypeName": "",
    "candidate.testTypeCode": "",
    "candidate.testTypeName": "",
    "candidate.admissionTypeCode": candidate?.admissionCode || "",
    "candidate.admissionTypeName": candidate?.admissionName || context.schedule.admissionName,
    "candidate.campusCode": "",
    "candidate.campusName": "",
    "candidate.collegeCode": "",
    "candidate.collegeName": "",
    "candidate.seriesCode": "",
    "candidate.seriesName": "",
    "candidate.departmentCode": candidate?.unitCode || "",
    "candidate.departmentName": candidate?.unitName || "",
    "candidate.majorCode": candidate?.majorCode || "",
    "candidate.majorName": candidate?.majorName || "",
    "candidate.periodCode": candidate?.periodCode || "",
    "candidate.periodName": candidate?.periodName || context.schedule.periodName,
    "candidate.groupName": candidate?.groupName || "",
    "candidate.buildingCode": candidate?.buildingCode || "",
    "candidate.buildingName": candidate?.buildingName || "",
    "candidate.waitingRoomName": candidate?.waitingRoom || "",
    "candidate.roomCode": candidate?.roomCode || "",
    "candidate.roomName": candidate?.roomName || "",
    "candidate.seatNo": candidate?.seatNo || "",
    "candidate.absent": row ? operationRowAttendance(row, attendanceContext) : "",
    "candidate.photo": photo,
    "candidate.opt1": candidate?.opt1 || "",
    "candidate.opt2": candidate?.opt2 || "",
    "candidate.opt3": candidate?.opt3 || "",
    "room.assignedCount": counts.total,
    "room.presentCount": counts.present,
    "room.absentCount": counts.absent,
    "row.indexInPage": index + 1,
  };
}

function blobToDataUrl(blob: Blob, signal?: AbortSignal) {
  throwIfAborted(signal);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      if (reader.readyState === FileReader.LOADING) reader.abort();
      finish(() => reject(abortReason(signal)));
    };
    reader.addEventListener("load", () => finish(() => resolve(String(reader.result || ""))), { once: true });
    reader.addEventListener(
      "error",
      () => finish(() => reject(new Error("수험생 사진을 PDF에 반영하지 못했습니다."))),
      { once: true },
    );
    reader.addEventListener("abort", () => finish(() => reject(abortReason(signal))), { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    reader.readAsDataURL(blob);
  });
}

function abortReason(signal?: AbortSignal): unknown {
  try {
    throwIfAborted(signal);
  } catch (reason) {
    return reason;
  }
  return new DOMException("작업이 취소되었습니다.", "AbortError");
}

export function operationTemplateScopeLabel(scope: FormTemplate["usageScope"]) {
  if (scope === "ROOM") return "고사실별";
  if (scope === "EXAM") return "시험 전체";
  return "수험생별";
}
