import type { DeveloperSettings } from "../../shared/api/developer-settings";
import { fetchExamineePhoto, type OperationSchedule } from "../../shared/api/examinees";
import type { FormTemplate } from "../../shared/api/form-templates";
import { boundedMap, isAbortError, throwIfAborted } from "../../shared/async/bounded-map";
import { getTemplateDocumentHtml, renderTemplateHtml } from "../templates/template-renderer";
import { emptyTemplateSignatureNames, type TemplateSignatureNames } from "../templates/template-signatures";
import type { OperationRow } from "./operation-view-model";

export interface OperationTemplateContext {
  token: string;
  systemProfile: DeveloperSettings;
  schedule: OperationSchedule;
  examName: string;
  operationClosed: boolean;
  signatureNames?: TemplateSignatureNames;
  signal?: AbortSignal;
  onPhotoProgress?(completed: number, total: number): void;
}

export async function buildOperationTemplatePages(
  template: FormTemplate,
  rows: OperationRow[],
  context: OperationTemplateContext,
) {
  throwIfAborted(context.signal);
  if (!rows.length) throw new Error("PDF로 생성할 수험생 데이터가 없습니다.");
  const requiresPhoto = getTemplateDocumentHtml(template.layout).includes("candidate.photo");
  if (template.usageScope === "CANDIDATE") {
    return boundedMap(
      rows,
      async (row, index) => {
        throwIfAborted(context.signal);
        let photo = "";
        if (requiresPhoto) {
          const blob = await fetchExamineePhoto(
            row.candidate.examineeNo,
            context.token,
            context.schedule,
            context.signal,
          ).catch((reason: unknown) => {
            if (isAbortError(reason)) throw reason;
            return null;
          });
          if (blob) photo = await blobToDataUrl(blob, context.signal);
        }
        throwIfAborted(context.signal);
        return renderTemplateHtml(template.layout, templateValues(row, rows, index, context, photo));
      },
      {
        concurrency: requiresPhoto ? 4 : 8,
        signal: context.signal,
        onProgress: requiresPhoto ? context.onPhotoProgress : undefined,
      },
    );
  }
  if (template.usageScope === "ROOM") {
    const rooms = Array.from(
      rows
        .reduce<Map<string, OperationRow[]>>((groups, row) => {
          const key = `${row.candidate.buildingName}|${row.candidate.roomName}`;
          groups.set(key, [...(groups.get(key) || []), row]);
          return groups;
        }, new Map())
        .values(),
    );
    return rooms.map((roomRows, index) =>
      renderTemplateHtml(template.layout, templateValues(roomRows[0], roomRows, index, context, "")),
    );
  }
  return [renderTemplateHtml(template.layout, templateValues(rows[0], rows, 0, context, ""))];
}

function templateValues(
  row: OperationRow | undefined,
  groupRows: OperationRow[],
  index: number,
  context: OperationTemplateContext,
  photo: string,
) {
  const candidate = row?.candidate;
  const assignment = row?.assignment;
  const absentCount = groupRows.filter(
    (item) => item.candidate.absent || (context.operationClosed && !item.assignment),
  ).length;
  const presentCount = groupRows.filter((item) => item.assignment && !item.candidate.absent).length;
  return {
    ...emptyTemplateSignatureNames(),
    ...(context.signatureNames || {}),
    "system.title": context.systemProfile.systemName,
    "system.printedAt": new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(),
    ),
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
    "candidate.roomCode": candidate?.roomCode || "",
    "candidate.roomName": candidate?.roomName || "",
    "candidate.seatNo": candidate?.seatNo || "",
    "candidate.absent": candidate
      ? candidate.absent || (context.operationClosed && !assignment)
        ? "결시"
        : "응시"
      : "",
    "candidate.photo": photo,
    "candidate.opt1": candidate?.opt1 || "",
    "candidate.opt2": candidate?.opt2 || "",
    "candidate.opt3": candidate?.opt3 || "",
    "room.assignedCount": groupRows.length,
    "room.presentCount": presentCount,
    "room.absentCount": absentCount,
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
