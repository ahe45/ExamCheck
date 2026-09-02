import { describe, expect, it } from "vitest";
import { resolveIdentityTransitionConfig } from "./identity-transition-config.js";

describe("identity transition configuration", () => {
  it("keeps every new-model path disabled by default", () => {
    expect(resolveIdentityTransitionConfig({})).toEqual({ enabled: false, shadowHmacSecret: null });
  });

  it("enables the database-controlled transition behind an emergency master switch", () => {
    expect(
      resolveIdentityTransitionConfig({
        IDENTITY_TRANSITION_ENABLED: " true ",
        IDENTITY_SHADOW_HMAC_SECRET: "0123456789abcdef0123456789abcdef",
      }),
    ).toEqual({ enabled: true, shadowHmacSecret: "0123456789abcdef0123456789abcdef" });
  });

  it("rejects ambiguous switches and weak shadow secrets", () => {
    expect(() => resolveIdentityTransitionConfig({ IDENTITY_TRANSITION_ENABLED: "yes" })).toThrow(
      "IDENTITY_TRANSITION_ENABLED",
    );
    expect(() => resolveIdentityTransitionConfig({ IDENTITY_SHADOW_HMAC_SECRET: "too-short" })).toThrow(
      "at least 32 bytes",
    );
  });
});
