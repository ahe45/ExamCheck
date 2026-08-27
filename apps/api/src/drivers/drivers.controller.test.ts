import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { PERMISSIONS_KEY } from "../auth/permissions.js";
import { DriversController } from "./drivers.controller.js";

describe("DriversController authorization", () => {
  it("requires the shared driver download permission for the fixed installer allowlist", () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, DriversController)).toEqual(["driver.download"]);
  });
});
