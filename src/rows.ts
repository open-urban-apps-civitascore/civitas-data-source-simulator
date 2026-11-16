import { getPath, sequenceValueOf } from "./generators.js";

/** Where a simulation with rows keeps them: a SQL table, or a list served over REST. */
export interface RowSink {
  /** Highest counter used for `prefix`, so a restart continues the series. */
  maxSequence(field: string, prefix: string): Promise<number | null>;
  countRows(): Promise<number>;
  write(rows: Record<string, unknown>[]): Promise<number>;
  /**
   * Swaps this simulation's rows for these in one step, so a reader never finds
   * it empty. `keyPrefix` names its key series where others may share the rows.
   */
  replace(rows: Record<string, unknown>[], keyPrefix?: string): Promise<number>;
}

/** A REST simulation's rows. Kept through a pause and an edit, gone after a restart of the service. */
export class MemoryRows implements RowSink {
  private rows: Record<string, unknown>[] = [];

  list(): readonly Record<string, unknown>[] {
    return this.rows;
  }

  async maxSequence(field: string, prefix: string): Promise<number | null> {
    let highest: number | null = null;
    for (const row of this.rows) {
      const value = sequenceValueOf(String(getPath(row, field) ?? ""), prefix);
      if (value !== null && (highest === null || value > highest)) highest = value;
    }
    return highest;
  }

  async countRows(): Promise<number> {
    return this.rows.length;
  }

  async write(rows: Record<string, unknown>[]): Promise<number> {
    this.rows.push(...rows);
    return rows.length;
  }

  async replace(rows: Record<string, unknown>[]): Promise<number> {
    this.rows = [...rows];
    return rows.length;
  }
}
