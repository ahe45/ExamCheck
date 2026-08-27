import { useEffect, useRef, useState } from "react";
import type { Examinee, OperationSchedule } from "../../shared/api/examinees";
import { completePrintJob, createPrintJob } from "../../shared/api/print-jobs";
import type { PseudonymAssignment } from "../../shared/api/pseudonyms";
import type { OperationNotice } from "./operation-candidate-state";
import { createOperationRequestTarget, type OperationRequestTarget } from "./operation-request-guard";
import type { PrinterService } from "../printer/PrinterService";
import type { PrinterDiagnostic } from "../printer/printer.types";

interface Options {
  token: string;
  userRole: string;
  schedule: OperationSchedule;
  scheduleKey: string;
  candidate: Examinee | null;
  assignment: PseudonymAssignment | null;
  service: PrinterService;
  diagnostic: PrinterDiagnostic;
  isCurrentTarget(target: OperationRequestTarget): boolean;
  onNotice(notice: OperationNotice): void;
}

export function useOperationLabelPrint(options: Options) {
  const [printing, setPrinting] = useState(false);
  const printingRef = useRef(false);

  useEffect(() => setPrinting(false), [options.scheduleKey]);

  async function print() {
    if (!options.candidate || !options.assignment || printing || printingRef.current || options.userRole === "VIEWER")
      return;
    if (!options.diagnostic.printer) {
      options.onNotice({ kind: "error", text: "프린터 설정 화면에서 출력 환경을 먼저 확인해 주세요." });
      return;
    }
    const requestTarget = createOperationRequestTarget(options.candidate.examineeNo, options.schedule);
    const idempotencyKey = globalThis.crypto.randomUUID();
    printingRef.current = true;
    setPrinting(true);
    let jobId: string | null = null;
    try {
      const job = await createPrintJob(
        options.token,
        options.candidate.examineeNo,
        1,
        {
          examName: options.candidate.examName,
          examDate: options.schedule.date,
          examTime: options.schedule.time,
          periodName: options.schedule.periodName,
          admissionName: options.schedule.admissionName,
        },
        idempotencyKey,
      );
      jobId = job.id;
      for (let copy = 0; copy < job.copies; copy += 1) {
        await options.service.sendRaw(options.diagnostic.printer, job.payload);
      }
      await completePrintJob(options.token, job.id, "SENT");
      if (options.isCurrentTarget(requestTarget)) {
        options.onNotice({
          kind: "success",
          text: `가번호 ${options.assignment.pseudonymNumber} 라벨 ${job.copies}매를 프린터로 전송했습니다.`,
        });
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "라벨 데이터를 전송하지 못했습니다.";
      if (jobId) {
        try {
          await completePrintJob(options.token, jobId, "FAILED", message);
        } catch {
          /* 원래 오류 유지 */
        }
      }
      if (options.isCurrentTarget(requestTarget)) options.onNotice({ kind: "error", text: message });
    } finally {
      printingRef.current = false;
      if (options.isCurrentTarget(requestTarget)) setPrinting(false);
    }
  }

  return { printing, print, reset: () => setPrinting(false) };
}
