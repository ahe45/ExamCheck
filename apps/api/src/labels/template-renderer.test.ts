import { describe, expect, it } from "vitest";
import { renderZplTemplate } from "./template-renderer.js";

describe("renderZplTemplate", () => {
  it("renders allow-listed placeholders and strips ZPL control characters", () => {
    expect(renderZplTemplate("^XA^FD{{NAME}}^FS^XZ", { NAME: "A^XZ~B" })).toBe("^XA^FDA XZ B^FS^XZ");
  });

  it("rejects missing values", () => {
    expect(() => renderZplTemplate("^XA^FD{{NAME}}^FS^XZ", {})).toThrow("Missing template value: NAME");
  });
});
