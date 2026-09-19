import { z } from "zod";
import { sessionSchema, type AuthUser, type Session } from "../api/auth";
import { operationScheduleSchema, type OperationSchedule } from "../api/examinees";
import { FORM_EDITOR_SESSION_KEY, LABEL_EDITOR_SESSION_KEY, TEMPLATE_TAB_SESSION_KEY } from "./template-session";

export const SESSION_KEY = "examcheck.session";
export const OPERATION_SCHEDULE_KEY = "examcheck.operation-schedule";

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const storedOperationScheduleSchema = z.object({
  userId: z.number().int().positive(),
  schedule: operationScheduleSchema,
});

export function readStoredSession(storage: SessionStorageLike): Session | null {
  const parsed = readJson(storage, SESSION_KEY, sessionSchema);
  if (!parsed) clearStoredAuthentication(storage);
  return parsed;
}

export function writeStoredSession(storage: SessionStorageLike, session: Session) {
  storage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function readStoredOperationSchedule(storage: SessionStorageLike, user: AuthUser): OperationSchedule | null {
  const stored = readJson(storage, OPERATION_SCHEDULE_KEY, storedOperationScheduleSchema);
  const permitted =
    stored &&
    stored.userId === user.id &&
    (user.role === "ADMIN" ||
      user.role === "DEVELOPER" ||
      user.admissionNames.length === 0 ||
      user.admissionNames.includes(stored.schedule.admissionName));
  if (!permitted) {
    storage.removeItem(OPERATION_SCHEDULE_KEY);
    return null;
  }
  return stored.schedule;
}

export function writeStoredOperationSchedule(storage: SessionStorageLike, userId: number, schedule: OperationSchedule) {
  storage.setItem(OPERATION_SCHEDULE_KEY, JSON.stringify({ userId, schedule }));
}

export function clearStoredOperationSchedule(storage: SessionStorageLike) {
  storage.removeItem(OPERATION_SCHEDULE_KEY);
}

export function clearStoredAuthentication(storage: SessionStorageLike) {
  storage.removeItem(SESSION_KEY);
  storage.removeItem(OPERATION_SCHEDULE_KEY);
  storage.removeItem(FORM_EDITOR_SESSION_KEY);
  storage.removeItem(LABEL_EDITOR_SESSION_KEY);
  storage.removeItem(TEMPLATE_TAB_SESSION_KEY);
}

function readJson<T>(storage: SessionStorageLike, key: string, schema: z.ZodType<T>): T | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
