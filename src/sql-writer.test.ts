import { afterEach, describe, expect, it, vi } from "vitest";

import { createSqlWriter } from "./sql-writer.js";

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
