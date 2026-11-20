import { apiFetch } from "./client";
import type { ClassificationMethod } from "../classification";

export type AccountRole = "ADMIN" | "USER";

export interface Account {
  id: number;
  loginId: string;
  role: AccountRole;
  admissionNames: string[];
  scopeBlocked?: boolean;
  createdAt: string;
  updatedAt: string | null;
  lastAccessAt?: string | null;
  isOnline?: number | boolean;
}

export interface AccountInput {
  loginId: string;
  role: AccountRole;
  password?: string;
  admissionNames: string[];
  classificationMethod?: ClassificationMethod;
  preserveClassificationAccess?: boolean;
}

export interface AccountScopeOptions {
  method: ClassificationMethod;
  scopes: { key: string; label: string }[];
}

export function fetchAccounts(token: string) {
  return apiFetch<Account[]>("/accounts", {}, token);
}

export function fetchAccountAdmissions(token: string) {
  return apiFetch<string[]>("/accounts/admissions", {}, token);
}

export function fetchAccountScopes(token: string) {
  return apiFetch<AccountScopeOptions>("/accounts/classification-scopes", {}, token);
}

export function createAccount(token: string, input: AccountInput & { password: string }) {
  return apiFetch<Account>("/accounts", { method: "POST", body: JSON.stringify(input) }, token);
}

export function updateAccount(token: string, id: number, input: AccountInput) {
  return apiFetch<Account>(`/accounts/${id}`, { method: "PUT", body: JSON.stringify(input) }, token);
}

export function deleteAccount(token: string, id: number) {
  return apiFetch<{ id: number; deleted: boolean }>(`/accounts/${id}`, { method: "DELETE" }, token);
}
