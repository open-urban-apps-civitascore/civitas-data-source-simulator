import pg from "pg";

import { CONNECT_TIMEOUT_MS } from "./connect-error.js";
import { quoteIdent } from "./sql-writer.js";
import { simulationInputSchema, type SimulationInput } from "./types.js";

// Keeps the settings each simulation was registered with; live state stays in the registry.

export interface StoredSimulation {
  id: string;
  input: SimulationInput;
  createdAt: Date;
}

export interface SimulationStore {
  /** Everything stored, for resuming after a restart. */
  list(): Promise<StoredSimulation[]>;
  /** Create or replace by id. */
  save(simulation: StoredSimulation): Promise<void>;
  /** Forget; an unknown id is not an error. */
  remove(id: string): Promise<void>;
}

/** Forgets everything on restart. Copies in and out, like a database. */
export class MemoryStore implements SimulationStore {
  private readonly simulations = new Map<string, StoredSimulation>();

  async list(): Promise<StoredSimulation[]> {
    return [...this.simulations.values()].map((simulation) => structuredClone(simulation));
  }

  async save(simulation: StoredSimulation): Promise<void> {
    this.simulations.set(simulation.id, structuredClone(simulation));
  }

  async remove(id: string): Promise<void> {
    this.simulations.delete(id);
  }
}

/** Append only: never edit a migration that has run. */
const MIGRATIONS: readonly ((schema: string) => string)[] = [
  (schema) => `CREATE TABLE ${schema}.simulations (
    id text PRIMARY KEY,
    input jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
];

/** Arbitrary, but unique within the database. */
const MIGRATION_LOCK = 430_017;

/** Keeps the settings in a schema of their own. */
export class PostgresStore implements SimulationStore {
  private readonly pool: pg.Pool;
  private readonly schema: string;

  constructor(dsn: string, { schema = "simulator" }: { schema?: string } = {}) {
    // Connects on first use, so the service can start before its database does.
    this.pool = new pg.Pool({ connectionString: dsn, max: 2, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
    this.schema = quoteIdent(schema);
  }

  /** Each migration once, in order, in one transaction. */
  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Two instances starting together take turns.
      await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.schema}.migrations (
          version integer PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`,
      );
      const { rows } = await client.query<{ version: number }>(
        `SELECT coalesce(max(version), 0) AS version FROM ${this.schema}.migrations`,
      );
      for (let version = (rows[0]?.version ?? 0) + 1; version <= MIGRATIONS.length; version++) {
        await client.query(MIGRATIONS[version - 1]!(this.schema));
        await client.query(`INSERT INTO ${this.schema}.migrations (version) VALUES ($1)`, [version]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async list(): Promise<StoredSimulation[]> {
    const { rows } = await this.pool.query<{ id: string; input: unknown; created_at: Date }>(
      `SELECT id, input, created_at FROM ${this.schema}.simulations ORDER BY created_at, id`,
    );
    return rows.flatMap((row) => {
      // Checked against today's format; a row that no longer fits is skipped, not deleted.
      const parsed = simulationInputSchema.safeParse(row.input);
      if (parsed.success) return [{ id: row.id, input: parsed.data, createdAt: row.created_at }];
      const reasons = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
      console.error(`[demo-generator] stored simulation ${row.id} no longer fits and is left out: ${reasons.join("; ")}`);
      return [];
    });
  }

  async save({ id, input, createdAt }: StoredSimulation): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.simulations (id, input, created_at) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (id) DO UPDATE
       SET input = EXCLUDED.input, created_at = EXCLUDED.created_at, updated_at = now()`,
      [id, JSON.stringify(input), createdAt],
    );
  }

  async remove(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.schema}.simulations WHERE id = $1`, [id]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
