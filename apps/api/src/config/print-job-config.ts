export const DEFAULT_PRINT_JOB_EXPIRY_SECONDS = 300;

export interface PrintJobEnvironment {
  PRINT_JOB_EXPIRY_SECONDS?: string;
}

export interface PrintJobConfig {
  expirySeconds: number;
}

export function resolvePrintJobExpirySeconds(configuredValue: string | undefined): number {
  if (configuredValue === undefined) return DEFAULT_PRINT_JOB_EXPIRY_SECONDS;
  const parsed = Number(configuredValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("PRINT_JOB_EXPIRY_SECONDS must be a positive integer.");
  }
  return parsed;
}

export function resolvePrintJobConfig(environment: PrintJobEnvironment): PrintJobConfig {
  return { expirySeconds: resolvePrintJobExpirySeconds(environment.PRINT_JOB_EXPIRY_SECONDS) };
}
