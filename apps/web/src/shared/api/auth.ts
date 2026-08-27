import { z } from "zod";
import { apiFetch } from "./client";

export const userRoleSchema = z.enum(["ADMIN", "OPERATOR", "VIEWER", "DEVELOPER"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const authUserSchema = z.object({
  id: z.number().int().positive(),
  loginId: z.string().min(1),
  role: userRoleSchema,
  admissionNames: z.array(z.string()),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const sessionSchema = z.object({
  token: z.string().min(1),
  user: authUserSchema,
});
export type Session = z.infer<typeof sessionSchema>;

export function login(loginId: string, password: string) {
  return apiFetch(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ loginId, password }),
    },
    undefined,
    sessionSchema,
  );
}

export function fetchCurrentUser(token: string) {
  return apiFetch("/auth/me", {}, token, authUserSchema);
}
