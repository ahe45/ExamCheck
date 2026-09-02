export interface IdentityTransitionEnvironment {
  IDENTITY_TRANSITION_ENABLED?: string;
  IDENTITY_SHADOW_HMAC_SECRET?: string;
}

export interface IdentityTransitionConfig {
  enabled: boolean;
  shadowHmacSecret: string | null;
}

export function resolveIdentityTransitionConfig(environment: IdentityTransitionEnvironment): IdentityTransitionConfig {
  const enabled = resolveBoolean(environment.IDENTITY_TRANSITION_ENABLED, false);
  const shadowHmacSecret = environment.IDENTITY_SHADOW_HMAC_SECRET?.trim() || null;
  if (shadowHmacSecret !== null && Buffer.byteLength(shadowHmacSecret, "utf8") < 32) {
    throw new Error("IDENTITY_SHADOW_HMAC_SECRET must contain at least 32 bytes when configured.");
  }
  return { enabled, shadowHmacSecret };
}

function resolveBoolean(value: string | undefined, defaultValue: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("IDENTITY_TRANSITION_ENABLED must be true or false.");
}
