export interface IdentityTransitionEnvironment {
  IDENTITY_TRANSITION_ENABLED?: string;
  IDENTITY_SHADOW_HMAC_SECRET?: string;
}

export interface IdentityTransitionConfig {
  enabled: boolean;
  shadowHmacSecret: string | null;
}

export function resolveIdentityTransitionConfig(environment: IdentityTransitionEnvironment): IdentityTransitionConfig {
  void environment;
  return { enabled: false, shadowHmacSecret: null };
}
