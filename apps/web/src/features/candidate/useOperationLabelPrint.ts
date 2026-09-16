import { useEffect, useRef, useState } from "react";
import type { Examinee, OperationSchedule } from "../../shared/api/examinees";
import { completePrintJob, createPrintJob } from "../../shared/api/print-jobs";
import type { PseudonymAssignment, PseudonymSetting } from "../../shared/api/pseudonyms";
import type { OperationNotice } from "./operation-candidate-state";
import { createOperationRequestTarget, type OperationRequestTarget } from "./operation-request-guard";
import type { PrinterService } from "../printer/PrinterService";
import type { PrinterDiagnostic } from "../printer/printer.types";
import type { OperationLookupSelection } from "./useOperationLookupAndPrint";

interface Options {
  token: string;
  userRole: string;
  schedule: OperationSchedule;
  scheduleKey: string;
  candidate: Examinee | null;
  assignment: PseudonymAssignment | null;
  labelPrintDefaults?: PseudonymSetting["labelPrintDefaults"];
  service: PrinterService;
  diagnostic: PrinterDiagnostic;
  isCurrentTarget(target: OperationRequestTarget): boolean;
  onNotice(notice: OperationNotice): void;
}

export function useOperationLabelPrint(options: Options) {
  const [printing, setPrinting] = useState(false);
  const printingRef = useRef(false);
  const [printedTargets, setPrintedTargets] = useState<ReadonlySet<string>>(() => new Set());
  const printedTargetsRef = useRef(new Set<string>());
  const printTargetKey = (candidate: Examinee) =>
    JSON.stringify([options.token, options.scheduleKey, candidate.id, candidate.examineeNo]);
  const alreadyPrinted = Boolean(
    options.candidate && (options.candidate.lastPrintedAt || printedTargets.has(printTargetKey(options.candidate))),
  );
  const defaultCopies = options.labelPrintDefaults?.copies ?? 1;
  const copiesKey = JSON.stringify([
    options.token,
    options.scheduleKey,
    options.labelPrintDefaults?.templateId,
    defaultCopies,
  ]);
  const [override, setOverride] = useState<{ key: string; value: number | "" } | null>(null);
  const copies = override?.key === copiesKey ? override.value : defaultCopies;
  const copiesValid = Number.isInteger(copies) && Number(copies) >= 1 && Number(copies) <= 10;
  useEffect(() => setOverride(null), [copiesKey]);
  function setCopies(value: number | "") {
    if (!printingRef.current) setOverride({ key: copiesKey, value });
  }

  useEffect(() => setPrinting(false), [options.scheduleKey]);

  async function print(selection?: OperationLookupSelection) {
    const candidate = selection ? selection.candidate : options.candidate;
    const assignment = selection ? selection.assignment : options.assignment;
    if (!candidate || !assignment || printing || printingRef.current || options.userRole === "VIEWER") return;
    if (candidate.lastPrintedAt || printedTargetsRef.current.has(printTargetKey(candidate))) {
      options.onNotice({ kind: "error", text: "이미 출력된 수험생은 라벨을 재출력할 수 없습니다." });
      return;
    }
    if (!copiesValid) {
      options.onNotice({ kind: "error", text: "출력 매수는 1~10 사이의 정수로 입력해 주세요." });
      return;
    }
    if (options.diagnostic.status !== "READY" || !options.diagnostic.printer) {
      options.onNotice({ kind: "error", text: "프린터 설정 화면에서 출력 환경을 먼저 확인해 주세요." });
      return;
    }
    const requestTarget = createOperationRequestTarget(candidate.examineeNo, options.schedule);
    if (selection && !options.isCurrentTarget(requestTarget)) return;
    const idempotencyKey = globalThis.crypto.randomUUID();
    printingRef.current = true;
    setPrinting(true);
    let jobId: string | null = null;
    try {
      const job = await createPrintJob(
        options.token,
        candidate.examineeNo,
        Number(copies),
        {
          examName: candidate.examName,
          examDate: options.schedule.date,
          examTime: options.schedule.time,
          periodName: options.schedule.periodName,
          admissionName: options.schedule.admissionName,
        },
        idempotencyKey,
      );
      if (job.status !== "READY") throw new Error("이미 처리된 출력 작업은 다시 전송할 수 없습니다.");
      jobId = job.id;
      for (let copy = 0; copy < job.copies; copy += 1) {
        await options.service.sendRaw(options.diagnostic.printer, job.payload);
      }
      await completePrintJob(options.token, job.id, "SENT");
      printedTargetsRef.current.add(printTargetKey(candidate));
      setPrintedTargets(new Set(printedTargetsRef.current));
      if (options.isCurrentTarget(requestTarget)) {
        options.onNotice({
          kind: "success",
          text: `가번호 ${assignment.pseudonymNumber} 라벨 ${job.copies}매를 프린터로 전송했습니다.`,
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
      setPrinting(false);
    }
  }

  return {
    printing,
    print,
    alreadyPrinted,
    copies,
    defaultCopies,
    copiesValid,
    setCopies,
    clearCandidateHistory: (candidate: Examinee) => {
      printedTargetsRef.current.delete(printTargetKey(candidate));
      setPrintedTargets(new Set(printedTargetsRef.current));
    },
    clearHistory: () => {
      for (const key of printedTargetsRef.current) {
        const [token, scheduleKey] = JSON.parse(key) as string[];
        if (token === options.token && scheduleKey === options.scheduleKey) printedTargetsRef.current.delete(key);
      }
      setPrintedTargets(new Set(printedTargetsRef.current));
    },
    reset: () => setPrinting(false),
  };
}
