import { code128GeneratedObjectSourceKeys } from "examlist-template-editor/core";
import type { DataTagDefinition } from "../../shared/templates/template-editor-contracts";

// Match ExamList's Code128 choices and include ExamCheck's numeric data fields.
const additionalSourceKeys = new Set([
  "candidate.preassignedNo",
  "candidate.seatNo",
  "room.presentCount",
  "room.absentCount",
]);

export function isBarcodeSource(tag: DataTagDefinition) {
  const key = String(tag.key || tag.dataKey || "");
  return tag.type !== "image" && (code128GeneratedObjectSourceKeys.has(key) || additionalSourceKeys.has(key));
}
