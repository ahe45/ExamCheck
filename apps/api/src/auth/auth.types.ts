export type UserRole = "ADMIN" | "OPERATOR" | "VIEWER" | "DEVELOPER";

export interface AuthenticatedUser {
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
