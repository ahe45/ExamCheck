import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { DatabasePoolLifecycle } from "./database.module.js";

describe("DatabasePoolLifecycle", () => {
  it("ends the shared pool exactly once during graceful shutdown", async () => {
    const end = vi.fn(async () => undefined);
    const lifecycle = new DatabasePoolLifecycle({ end } as Pick<Pool, "end">);

    await Promise.all([lifecycle.onApplicationShutdown(), lifecycle.onApplicationShutdown()]);

    expect(end).toHaveBeenCalledOnce();
  });

  it("propagates pool shutdown failures", async () => {
    const lifecycle = new DatabasePoolLifecycle({
      end: vi.fn(async () => {
        throw new Error("close failed");
      }),
    } as Pick<Pool, "end">);

    await expect(lifecycle.onApplicationShutdown()).rejects.toThrow("close failed");
  });
});
