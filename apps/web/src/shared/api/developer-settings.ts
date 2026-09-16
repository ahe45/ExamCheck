import { z } from "zod";
import { apiFetch } from "./client";

export const examineeNoUniquenessSchema = z.enum(["SYSTEM", "SCHEDULE"]);
export const pseudonymNoUniquenessSchema = z.enum(["ADMISSION", "SCHEDULE"]);
export type ExamineeNoUniqueness = z.infer<typeof examineeNoUniquenessSchema>;
export type PseudonymNoUniqueness = z.infer<typeof pseudonymNoUniquenessSchema>;

export const developerSettingsSchema = z.object({
  schoolName: z.string(),
  academicYear: z.number().int(),
  systemName: z.string(),
  examineeNoUniqueness: examineeNoUniquenessSchema,
  pseudonymNoUniqueness: pseudonymNoUniquenessSchema,
  logoFileName: z.string().nullable(),
  logoDataUrl: z.string().nullable(),
  updatedAt: z.string(),
});
export type DeveloperSettings = z.infer<typeof developerSettingsSchema>;

export interface DeveloperSettingsInput {
  schoolName: string;
  academicYear: number;
  systemName: string;
  examineeNoUniqueness: ExamineeNoUniqueness;
  pseudonymNoUniqueness: PseudonymNoUniqueness;
}

export function fetchDeveloperSettings(token: string) {
  return apiFetch("/developer-settings", {}, token, developerSettingsSchema);
}

export function fetchHistoryResetPassword(token: string) {
  return apiFetch("/developer-settings/history-reset-password", {}, token, z.object({ configured: z.boolean() }));
}

export function updateHistoryResetPassword(token: string, newPassword: string) {
  return apiFetch(
    "/developer-settings/history-reset-password",
    {
      method: "PUT",
      body: JSON.stringify({ newPassword }),
    },
    token,
    z.object({ configured: z.boolean() }),
  );
}

export function fetchSystemProfile() {
  return apiFetch("/system-profile", {}, undefined, developerSettingsSchema);
}

export function updateDeveloperSettings(token: string, input: DeveloperSettingsInput) {
  return apiFetch(
    "/developer-settings",
    { method: "PUT", body: JSON.stringify(input) },
    token,
    developerSettingsSchema,
  );
}

export function uploadDeveloperLogo(token: string, file: File) {
  const body = new FormData();
  body.append("file", file);
  return apiFetch("/developer-settings/logo", { method: "POST", body }, token, developerSettingsSchema);
}

export function removeDeveloperLogo(token: string) {
  return apiFetch("/developer-settings/logo", { method: "DELETE" }, token, developerSettingsSchema);
}

export function changeDeveloperPassword(token: string, input: { currentPassword: string; newPassword: string }) {
  return apiFetch<{ changed: boolean }>(
    "/developer-settings/password",
    { method: "PUT", body: JSON.stringify(input) },
    token,
  );
}
