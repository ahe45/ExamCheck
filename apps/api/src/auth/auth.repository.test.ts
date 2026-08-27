import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { AuthRepository } from "./auth.repository.js";

describe("AuthRepository", () => {
  it("maps admission assignments to an ordered name list", async () => {
    const execute = vi.fn().mockResolvedValue([[{ admissionName: "A전형" }, { admissionName: "B전형" }], []]);
    const repository = new AuthRepository({ execute } as unknown as Pool);

    await expect(repository.listAdmissionNames(7)).resolves.toEqual(["A전형", "B전형"]);
    expect(execute.mock.calls[0][1]).toEqual([7]);
  });

  it("returns null when a login ID has no account", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const repository = new AuthRepository({ execute } as unknown as Pool);

    await expect(repository.findUserByLoginId("missing")).resolves.toBeNull();
    expect(String(execute.mock.calls[0][0])).toContain("WHERE login_id = ?");
  });
});
