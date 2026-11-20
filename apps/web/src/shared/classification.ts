import { z } from "zod";

export const classificationLabels = {
  NONE: "분류 없음",
  ADMISSION: "전형별",
  UNIT: "모집단위별",
  MAJOR: "전공별",
  BUILDING: "고사건물별",
  ROOM: "고사실별",
  WAITING_ROOM: "대기실별",
  DATE: "시험날짜별",
  PERIOD: "교시별",
  GROUP: "조별",
} as const;

export type ClassificationMethod = keyof typeof classificationLabels;
export const classificationMethodSchema = z.enum(Object.keys(classificationLabels) as ClassificationMethod[]);

export function operationScopeMethod(scope: string): ClassificationMethod {
  const method = /^~([A-Z_]+):[0-9a-f]{64}$/.exec(scope)?.[1];
  const parsed = classificationMethodSchema.safeParse(method);
  return parsed.success ? parsed.data : "ADMISSION";
}

export function operationScopeFieldLabel(scope: string): string {
  const method = operationScopeMethod(scope);
  if (method === "ADMISSION") return "전형명";
  return method === "NONE" ? "운영 범위" : classificationLabels[method].slice(0, -1);
}
