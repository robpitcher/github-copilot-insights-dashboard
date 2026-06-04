import { describe, expect, it } from "vitest";
import { getMigrationStatusVariant } from "../migration-status";

describe("getMigrationStatusVariant", () => {
  it("prefers pending migrations over an 'in sync' label", () => {
    expect(getMigrationStatusVariant(true, false)).toBe("pending");
  });

  it("shows drift when schema drift exists without pending migrations", () => {
    expect(getMigrationStatusVariant(false, true)).toBe("drift");
  });

  it("shows in sync when neither pending migrations nor drift exist", () => {
    expect(getMigrationStatusVariant(false, false)).toBe("inSync");
  });
});
