import { describe, expect, it } from "vitest";
import { resolveIdentityTransitionConfig } from "./identity-transition-config.js";

describe("identity transition configuration", () => {
  it("keeps every new-model path disabled by default", () => {
    expect(resolveIdentityTransitionConfig({})).toEqual({ enabled: false, shadowHmacSecret: null });
  });

  it("ignores removed transition switches", () => {
    expect(
      resolveIdentityTransitionConfig({
        IDENTITY_TRANSITION_ENABLED: " true ",
        IDENTITY_SHADOW_HMAC_SECRET: "0123456789abcdef0123456789abcdef",
      }),
    ).toEqual({ enabled: false, shadowHmacSecret: null });
  });

  it("remains disabled for legacy values that may still exist in deployment configuration", () => {
    expect(resolveIdentityTransitionConfig({ IDENTITY_TRANSITION_ENABLED: "yes" })).toEqual({
      enabled: false,
      shadowHmacSecret: null,
    });
    expect(resolveIdentityTransitionConfig({ IDENTITY_SHADOW_HMAC_SECRET: "too-short" })).toEqual({
      enabled: false,
      shadowHmacSecret: null,
    });
  });
});
