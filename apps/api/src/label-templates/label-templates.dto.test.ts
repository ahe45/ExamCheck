import "reflect-metadata";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { SaveLabelTemplateDto } from "./label-templates.dto.js";

describe("label template default copies validation", () => {
  it.each([0, 11, 1.5, "2"])("rejects %s", async (defaultCopies) => {
    const input = Object.assign(new SaveLabelTemplateDto(), { code: "TEST", name: "라벨", layout: {}, defaultCopies });
    expect((await validate(input)).some((error) => error.property === "defaultCopies")).toBe(true);
  });
  it.each([undefined, 1, 10])("accepts %s", async (defaultCopies) => {
    const input = Object.assign(new SaveLabelTemplateDto(), { code: "TEST", name: "라벨", layout: {}, defaultCopies });
    expect(await validate(input)).toEqual([]);
  });
});
