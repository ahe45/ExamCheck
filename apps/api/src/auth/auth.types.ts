import type { ClassificationMethod } from "../authorization/classification.js";

export type UserRole = "ADMIN" | "OPERATOR" | "VIEWER" | "DEVELOPER";

export interface AuthenticatedUser {
  classificationMethod?: ClassificationMethod;
  scopeBlocked?: boolean;
  id: number;
  loginId: string;
  role: UserRole;
  admissionNames: string[];
}

export interface SessionClaims {
  sub: number;
  role: UserRole;
  sessionVersion: number;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface AuthenticatedSessionUser {
  user: AuthenticatedUser;
  sessionVersion: number;
}
