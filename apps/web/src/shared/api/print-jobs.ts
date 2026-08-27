import { apiFetch } from "./client";
import { WORKSTATION_CODE } from "../config/workstation";

export interface PrintJob {
  id: string;
  jobNo: string;
  status: "CREATED" | "READY" | "DISPATCHING" | "SENT" | "FAILED" | "CANCELLED" | "EXPIRED";
  copies: number;
  format: "ZPL";
  payload: string;
}

export function createPrintJob(
  token: string,
  examineeNo: string,
  copies: number,
  schedule: { examName: string; examDate: string; examTime: string; periodName: string; admissionName: string },
  idempotencyKey: string,
) {
  return apiFetch<PrintJob>(
    "/print-jobs",
    {
      method: "POST",
      body: JSON.stringify({ idempotencyKey, examineeNo, copies, workstationCode: WORKSTATION_CODE, ...schedule }),
    },
    token,
  );
}

export function completePrintJob(token: string, id: string, status: "SENT" | "FAILED", errorMessage?: string) {
  return apiFetch<{ id: string; status: string }>(
    `/print-jobs/${id}/result`,
    {
      method: "POST",
      body: JSON.stringify({ status, ...(errorMessage ? { errorMessage } : {}) }),
    },
    token,
  );
}
