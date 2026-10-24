import { describe, expect, it } from "vitest";

import { STATE_DSN_VAR, STATE_IN_MEMORY_VAR, readStateConfig } from "./config.js";

describe("readStateConfig", () => {
  it("keeps the settings in the database it is given", () => {
    expect(readStateConfig({ [STATE_DSN_VAR]: " postgres://db:5432/demo " })).toEqual({
      kind: "postgres",
      dsn: "postgres://db:5432/demo",
    });
  });

  it("keeps them in memory only when asked to", () => {
    expect(readStateConfig({ [STATE_IN_MEMORY_VAR]: "1" })).toEqual({ kind: "memory" });
  });

  it("refuses to guess when neither is set", () => {
    expect(() => readStateConfig({})).toThrow(/No storage configured/);
  });
});
