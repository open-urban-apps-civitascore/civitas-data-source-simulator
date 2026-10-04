import { afterEach, describe, expect, it, vi } from "vitest";

import { createSqlWriter, rowsPerStatement } from "./sql-writer.js";

describe("rowsPerStatement", () => {
  it("keeps every INSERT under Postgres' bind-parameter cap", () => {
    for (const columns of [1, 9, 10, 64, 200]) {
      expect(rowsPerStatement(columns) * columns).toBeLessThanOrEqual(65_535);
      expect((rowsPerStatement(columns) + 1) * columns).toBeGreaterThan(65_535);
    }
  });

  it("still writes one row at a time for a pathological width", () => {
    expect(rowsPerStatement(100_000)).toBe(1);
    expect(rowsPerStatement(0)).toBe(65_535);
  });
});

describe("createSqlWriter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says why it cannot reach the database", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Port 1 (tcpmux) is closed everywhere these tests run.
    const writer = createSqlWriter({
      dsn: "postgres://demo:pw@127.0.0.1:1/demo_source",
      table: "demo.readings",
      spec: { columns: { id: "text" }, primaryKey: "id" },
    });
    await expect(writer).rejects.toThrow("Unter 127.0.0.1:1 nimmt niemand Verbindungen an. Läuft die Datenbank");
  });
});
