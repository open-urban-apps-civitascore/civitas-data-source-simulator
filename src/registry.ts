import { compileScenario } from "./generators.js";
import { createPublisher, type Publisher } from "./publisher.js";
import { assertSameDatabase, createSqlWriter, type SqlWriter } from "./sql-writer.js";
import type { SimulationInput } from "./types.js";

/**
 * The set of running simulations, held IN MEMORY only.
 *
 * Deliberately stateless: the marketplace already holds the install records, so
 * persisting them here would be a second copy of the same truth — and two copies
 * eventually disagree. After a restart this registry is empty and the marketplace
 * re-registers what should be running. The exception is a SQL sequence counter,
 * whose rows outlive the process — it is read back from the table on every start.
 */

export interface SimulationStatus {
  id: string;
  enabled: boolean;
  transport: "mqtt" | "sql";
  /** MQTT only. */
  topic: string | null;
  /** Broker URL, or the table for SQL. */
  target: string;
  intervalSeconds: number;
  createdAt: string;
  /** Messages published (MQTT) or rows written (SQL). */
  publishedCount: number;
  /** SQL only. */
  rowCount: number | null;
  maxRows: number | null;
  lastPublishedAt: string | null;
  lastPayload: Record<string, unknown> | null;
  lastError: string | null;
}

interface Simulation {
  id: string;
  input: SimulationInput;
  createdAt: Date;
  render: (now: Date) => Record<string, unknown>;
  publisher: Publisher | null;
  writer: SqlWriter | null;
  timer: NodeJS.Timeout | null;
  publishedCount: number;
  rowCount: number | null;
  lastPublishedAt: Date | null;
  lastPayload: Record<string, unknown> | null;
  lastError: string | null;
}

interface StartedTransport {
  /** The timer body, and whether it should also run once immediately. */
  tick: () => Promise<void>;
  fireImmediately: boolean;
}

/** A demo tool must not be able to flood a municipal broker — or a municipal database. */
const MAX_SIMULATIONS = 50;

export class SimulationLimitError extends Error {
  readonly status = 429;
}

export class Registry {
  private readonly simulations = new Map<string, Simulation>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  /**
   * Create or replace a simulation. Idempotent by id (the caller supplies the
   * marketplace's dataset id), so re-registering after a restart — or a repeated
   * call from a retry — converges instead of duplicating publishers.
   */
  async put(id: string, input: SimulationInput): Promise<SimulationStatus> {
    const existing = this.simulations.get(id);
    if (!existing && this.simulations.size >= MAX_SIMULATIONS) {
      throw new SimulationLimitError(`Refusing more than ${MAX_SIMULATIONS} simulations.`);
    }
    if (existing) await this.teardown(existing);

    const simulation: Simulation = {
      id,
      input,
      createdAt: this.now(),
      render: compileScenario(input.scenario),
      publisher: null,
      writer: null,
      timer: null,
      publishedCount: 0,
      rowCount: null,
      lastPublishedAt: null,
      lastPayload: null,
      lastError: null,
    };
    this.simulations.set(id, simulation);

    if (input.enabled) {
      try {
        await this.start(simulation);
      } catch (error) {
        // Keep the promise the 502 makes: an unreachable broker or database is
        // reported, not registered as a simulation that silently produces nothing.
        this.simulations.delete(id);
        throw error;
      }
    }
    return toStatus(simulation);
  }

  get(id: string): SimulationStatus | null {
    const simulation = this.simulations.get(id);
    return simulation ? toStatus(simulation) : null;
  }

  list(): SimulationStatus[] {
    return [...this.simulations.values()].map(toStatus);
  }

  /** Stop and forget. Does not drop the table: the sink never deletes either. */
  async remove(id: string): Promise<boolean> {
    const simulation = this.simulations.get(id);
    if (!simulation) return false;
    await this.teardown(simulation);
    this.simulations.delete(id);
    return true;
  }

  /** Pause or resume without losing the scenario — useful mid-demo. */
  async setEnabled(id: string, enabled: boolean): Promise<SimulationStatus | null> {
    const simulation = this.simulations.get(id);
    if (!simulation) return null;
    if (enabled === simulation.input.enabled) return toStatus(simulation);

    simulation.input = { ...simulation.input, enabled };
    if (enabled) await this.start(simulation);
    else await this.teardown(simulation);
    return toStatus(simulation);
  }

  /** Render without publishing — powers the catalogue's pre-install data preview. */
  sample(id: string, count: number): Record<string, unknown>[] | null {
    const simulation = this.simulations.get(id);
    if (!simulation) return null;
    return renderSample(simulation.render, count, simulation.input.scenario.intervalSeconds, this.now());
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.simulations.values()].map((s) => this.teardown(s)));
    this.simulations.clear();
  }

  private async start(simulation: Simulation): Promise<void> {
    const { tick, fireImmediately } =
      simulation.input.transport.kind === "sql"
        ? await this.startSql(simulation)
        : await this.startMqtt(simulation);

    simulation.lastError = null;
    // SQL has already seeded; an immediate tick would write `seedRows + 1`.
    if (fireImmediately) void tick();
    simulation.timer = setInterval(tick, simulation.input.scenario.intervalSeconds * 1000);
  }

  private async startMqtt(simulation: Simulation): Promise<StartedTransport> {
    const transport = simulation.input.transport;
    if (transport.kind !== "mqtt") throw new Error("not an mqtt transport");

    simulation.publisher = await createPublisher({
      url: transport.url,
      topic: transport.topic,
      // Unique per simulation — see publisher.ts on why a shared id breaks silently.
      clientId: `civitas-demo-generator-${simulation.id}`,
    });

    const tick = async () => {
      const payload = simulation.render(this.now());
      try {
        await simulation.publisher?.publish(payload);
        this.recordSuccess(simulation, 1, payload);
      } catch (error) {
        // Keep the timer running: brokers come back, and a simulation that gives
        // up on the first blip would need a manual restart nobody would notice.
        this.recordFailure(simulation, error);
      }
    };
    return { tick, fireImmediately: true };
  }

  private async startSql(simulation: Simulation): Promise<StartedTransport> {
    const transport = simulation.input.transport;
    if (transport.kind !== "sql") throw new Error("not a sql transport");
    const scenario = simulation.input.scenario;
    const spec = scenario.table;
    // Both are guaranteed by simulationInputSchema's refinement; assert for types.
    if (!spec || scenario.maxRows === undefined) {
      throw new Error("A SQL simulation needs a table description and maxRows.");
    }
    const maxRows = scenario.maxRows;

    assertSameDatabase(transport.dsn, transport.readDsn);

    const writer = await createSqlWriter({ dsn: transport.dsn, table: transport.table, spec });
    simulation.writer = writer;
    await writer.ensureTable();

    // Read counters back before compiling, or a restart collides with every row.
    const resume: Record<string, number> = {};
    for (const [field, generator] of Object.entries(scenario.fields)) {
      if (generator.kind !== "sequence") continue;
      const highest = await writer.maxSequence(field, generator.prefix);
      if (highest !== null) resume[field] = highest + 1;
    }
    simulation.render = compileScenario(scenario, resume);
    simulation.rowCount = await writer.countRows();

    const writeRows = async (count: number) => {
      const room = Math.max(0, maxRows - (simulation.rowCount ?? 0));
      const rows = Array.from({ length: Math.min(count, room) }, () => simulation.render(this.now()));
      if (rows.length === 0) return;
      const written = await writer.write(rows);
      simulation.rowCount = await writer.countRows();
      this.recordSuccess(simulation, written, rows.at(-1) ?? null);
    };

    // Seed now, so the map is never empty while the first tick is pending.
    if (scenario.seedRows > 0) {
      try {
        await writeRows(scenario.seedRows);
      } catch (error) {
        // Fatal: a seeding failure means the table is wrong, not that the DB blinked.
        await writer.close().catch(() => undefined);
        simulation.writer = null;
        throw error;
      }
    }

    const tick = async () => {
      try {
        await writeRows(scenario.insertsPerTick);
      } catch (error) {
        this.recordFailure(simulation, error);
      }
    };
    return { tick, fireImmediately: false };
  }

  private recordSuccess(
    simulation: Simulation,
    written: number,
    payload: Record<string, unknown> | null,
  ): void {
    simulation.publishedCount += written;
    simulation.lastPublishedAt = this.now();
    simulation.lastPayload = payload;
    simulation.lastError = null;
  }

  private recordFailure(simulation: Simulation, error: unknown): void {
    simulation.lastError = error instanceof Error ? error.message : String(error);
  }

  private async teardown(simulation: Simulation): Promise<void> {
    if (simulation.timer) clearInterval(simulation.timer);
    simulation.timer = null;
    await simulation.publisher?.close().catch(() => undefined);
    simulation.publisher = null;
    await simulation.writer?.close().catch(() => undefined);
    simulation.writer = null;
  }
}

/**
 * Sample rendering walks the clock forward by the real interval, so a preview of a
 * `dailyProfile` field shows the curve moving instead of the same hour repeated.
 */
export function renderSample(
  render: (now: Date) => Record<string, unknown>,
  count: number,
  intervalSeconds: number,
  from: Date,
): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) =>
    render(new Date(from.getTime() + i * intervalSeconds * 1000)),
  );
}

function toStatus(simulation: Simulation): SimulationStatus {
  const transport = simulation.input.transport;
  return {
    id: simulation.id,
    enabled: simulation.input.enabled,
    transport: transport.kind,
    topic: transport.kind === "mqtt" ? transport.topic : null,
    target: transport.kind === "mqtt" ? transport.url : transport.table,
    intervalSeconds: simulation.input.scenario.intervalSeconds,
    createdAt: simulation.createdAt.toISOString(),
    publishedCount: simulation.publishedCount,
    rowCount: simulation.rowCount,
    maxRows: simulation.input.scenario.maxRows ?? null,
    lastPublishedAt: simulation.lastPublishedAt?.toISOString() ?? null,
    lastPayload: simulation.lastPayload,
    lastError: simulation.lastError,
  };
}
