import { describe, expect, it } from "vitest";
import { tableOrder } from "./database-backup.service.js";

describe("backup table dependency order", () => {
  it("restores parents before children and supports reverse deletion order", () => {
    const ordered = tableOrder(
      ["photos", "accounts", "candidates"],
      [
        { tableName: "photos", parent: "candidates" },
        { tableName: "candidates", parent: "accounts" },
      ],
    );
    expect(ordered).toEqual(["accounts", "candidates", "photos"]);
  });
  it("rejects cycles before deleting data", () => {
    expect(() =>
      tableOrder(
        ["a", "b"],
        [
          { tableName: "a", parent: "b" },
          { tableName: "b", parent: "a" },
        ],
      ),
    ).toThrow("순환 참조");
  });
});
