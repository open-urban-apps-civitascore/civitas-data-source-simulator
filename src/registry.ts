import { resolveSqlDsn } from "./config.js";
import { errorText } from "./connect-error.js";
import { compileScenario } from "./generators.js";
import { createPublisher, type Publisher } from "./publisher.js";
import { resolveTable } from "./row-schema.js";
import { assertSameDatabase, createSqlWriter, type SqlWriter } from "./sql-writer.js";
import { MemoryStore, type SimulationStore } from "./store.js";
import type { Cadence, Origin, SimulationInput } from "./types.js";

// Settings go through the store; live state stays here. SQL sequence counters
// are read back from the table.

export interface SimulationStatus {
  id: string;
  /** Null when the caller registered without one. */
  name: string | null;
  description: string | null;
  /** What the simulation belongs to on the platform; null when registered by hand. */
  origin: Origin | null;
  enabled: boolean;
  transport: "mqtt" | "sql";
  /** MQTT only. */
  topic: string | null;
  /** Broker URL, or the table for SQL. */
  target: string;
  intervalSeconds: number;
  /** `fillToLimit` writes once at start; `intervalSeconds` then means nothing. */
  cadence: Cadence;
  createdAt: string;
  /** Messages published (MQTT) or rows written (SQL). */
  publishedCount: number;
  /** SQL only. */
  rowCount: number | null;
  maxRows: number | null;
  /** SQL only: the table is full, so ticks write nothing. Not an error. */
  atCap: boolean;
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
  atCap: boolean;
  lastPublishedAt: Date | null;
  lastPayload: Record<string, unknown> | null;
  lastError: string | null;
}

interface StartedTransport {
  /** The timer body, and whether it should also run once immediately. */
  tick: () => Promise<void>;
  fireImmediately: boolean;
  /** False when the start already wrote everything there is to write. */
  repeats: boolean;
}

/** A demo tool must not be able to flood a municipal broker or database. */
const MAX_SIMULATIONS = 50;

export class SimulationLimitError extends Error {
  readonly status = 429;
}

export interface RegistryOptions {
  /** Defaults to memory. */
  store?: SimulationStore;
  now?: () => Date;
}

export class Registry {
  private readonly simulations = new Map<string, Simulation>();
  /** The last queued change per simulation; see `queue`. */
  private readonly pending = new Map<string, Promise<void>>();
  private readonly store: SimulationStore;
  private readonly now: () => Date;

  constructor({ store = new MemoryStore(), now = () => new Date() }: RegistryOptions = {}) {
    this.store = store;
    this.now = now;
  }


  /**
   * Create or replace. The new version starts before the old one stops, so a
   * failed edit keeps the old one running.
   */
  put(id: string, input: SimulationInput): Promise<SimulationStatus> {
    return this.queue(id, async () => {
      const existing = this.simulations.get(id);
      if (!existing && this.simulations.size >= MAX_SIMULATIONS) {
        throw new SimulationLimitError(`Refusing more than ${MAX_SIMULATIONS} simulations.`);
      }

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
        atCap: false,
        lastPublishedAt: null,
        lastPayload: null,
        lastError: null,
      };
      // A new id takes its place under the cap before the first await.
      if (!existing) this.simulations.set(id, simulation);

      try {
        if (input.enabled) await this.start(simulation);
        // Stored once it runs, so a version that cannot start is never kept.
        await this.store.save({ id, input, createdAt: simulation.createdAt });
      } catch (error) {
        // Release what the failed start opened.
        await this.teardown(simulation);
        if (!existing) this.simulations.delete(id);
        throw error;
      }

      this.simulations.set(id, simulation);
      if (existing) await this.teardown(existing);
      return toStatus(simulation);
    });
  }

  get(id: string): SimulationStatus | null {
    const simulation = this.simulations.get(id);
    return simulation ? toStatus(simulation) : null;
  }

  /** The configuration as registered. The status summarises, it cannot rebuild. */
  getInput(id: string): SimulationInput | null {
    return this.simulations.get(id)?.input ?? null;
  }

  list(): SimulationStatus[] {
    return [...this.simulations.values()].map(toStatus);
  }

  /** Stop and forget. Does not drop the table. */
  remove(id: string): Promise<boolean> {
    return this.queue(id, async () => {
      const simulation = this.simulations.get(id);
      if (!simulation) return false;
      // Store first: a refused delete leaves it running.
      await this.store.remove(id);
      await this.teardown(simulation);
      this.simulations.delete(id);
      return true;
    });
  }

  /**
   * Pause or resume without losing the scenario. Resuming connects BEFORE the
   * simulation is marked enabled: a failed start leaves it paused with the
   * reason recorded, never marked active with nothing running behind it. A
   * failed save leaves it as it was.
   */
  setEnabled(id: string, enabled: boolean): Promise<SimulationStatus | null> {
    return this.queue(id, async () => {
      const simulation = this.simulations.get(id);
      if (!simulation) return null;
      if (enabled === simulation.input.enabled) return toStatus(simulation);

      const input = { ...simulation.input, enabled };
      if (!enabled) {
        await this.store.save({ id, input, createdAt: simulation.createdAt });
        simulation.input = input;
        await this.teardown(simulation);
        return toStatus(simulation);
      }

      try {
        await this.start(simulation);
        await this.store.save({ id, input, createdAt: simulation.createdAt });
      } catch (error) {
        await this.teardown(simulation);
        simulation.lastError = errorText(error);
        throw error;
      }
      simulation.input = input;
      return toStatus(simulation);
    });
  }

  /** Render without publishing. */
  sample(id: string, count: number): Record<string, unknown>[] | null {
    const simulation = this.simulations.get(id);
    if (!simulation) return null;
    return renderSample(simulation.render, count, simulation.input.scenario.intervalSeconds, this.now());
  }

  /** Leaves the store alone: stopping the service switches nothing off. */
  async shutdown(): Promise<void> {
    // Let changes in flight finish, or a late start would keep running.
    await Promise.all(this.pending.values());
    await Promise.all([...this.simulations.values()].map((s) => this.teardown(s)));
    this.simulations.clear();
  }

  /**
   * One change per simulation at a time, so overlapping saves cannot leave an
   * untracked publisher behind. Different simulations change in parallel.
   */
  private queue<T>(id: string, change: () => Promise<T>): Promise<T> {
    const result = (this.pending.get(id) ?? Promise.resolve()).then(change);
    // The queue itself never rejects; each caller gets its own outcome.
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.pending.set(id, settled);
    void settled.then(() => {
      if (this.pending.get(id) === settled) this.pending.delete(id);
    });
    return result;
  }

  private async start(simulation: Simulation): Promise<void> {
    const { tick, fireImmediately, repeats } =
      simulation.input.transport.kind === "sql"
        ? await this.startSql(simulation)
        : await this.startMqtt(simulation);

    simulation.lastError = null;
    if (!repeats) return;
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
      // Unique per simulation; see publisher.ts.
      clientId: `civitas-demo-generator-${simulation.id}`,
    });

    const tick = async () => {
      const payload = simulation.render(this.now());
      try {
        await simulation.publisher?.publish(payload);
        this.recordSuccess(simulation, 1, payload);
      } catch (error) {
        // Keep the timer running: brokers come back.
        this.recordFailure(simulation, error);
      }
    };
    return { tick, fireImmediately: true, repeats: true };
  }

  private async startSql(simulation: Simulation): Promise<StartedTransport> {
    const transport = simulation.input.transport;
    if (transport.kind !== "sql") throw new Error("not a sql transport");
    const scenario = simulation.input.scenario;
    const spec = scenario.table;
    // Guaranteed by the schema refinement; asserted for the types.
    if (!spec || scenario.maxRows === undefined) {
      throw new Error("A SQL simulation needs a table description and maxRows.");
    }
    const maxRows = scenario.maxRows;

    const dsn = resolveSqlDsn(transport.dsn);
    assertSameDatabase(dsn, transport.readDsn);

    const resolved = resolveTable(spec);
    const writer = await createSqlWriter({ dsn, table: transport.table, spec: resolved });
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
    const rowsAtStart = await writer.countRows();
    simulation.rowCount = rowsAtStart;
    simulation.atCap = rowsAtStart >= maxRows;

    const writeRows = async (count: number) => {
      const room = Math.max(0, maxRows - (simulation.rowCount ?? 0));
      simulation.atCap = room === 0;
      const rows = Array.from({ length: Math.min(count, room) }, () => simulation.render(this.now()));
      if (rows.length === 0) return;
      const written = await writer.write(rows);
      simulation.rowCount = await writer.countRows();
      simulation.atCap = simulation.rowCount >= maxRows;
      this.recordSuccess(simulation, written, rows.at(-1) ?? null);
    };

    // Seed now, so the map is never empty. Top up rather than append, so a
    // restart writes only what the table lacks.
    const fill = scenario.cadence === "fillToLimit";
    const initialRows = Math.max(0, (fill ? maxRows : scenario.seedRows) - rowsAtStart);
    if (initialRows > 0) {
      try {
        await writeRows(initialRows);
      } catch (error) {
        // Fatal: seeding fails when the table is wrong, not on a blip.
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
    return { tick, fireImmediately: false, repeats: !fill };
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
    simulation.lastError = errorText(error);
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
    name: simulation.input.name ?? null,
    description: simulation.input.description ?? null,
    origin: simulation.input.origin ?? null,
    enabled: simulation.input.enabled,
    transport: transport.kind,
    topic: transport.kind === "mqtt" ? transport.topic : null,
    target: transport.kind === "mqtt" ? transport.url : transport.table,
    intervalSeconds: simulation.input.scenario.intervalSeconds,
    cadence: simulation.input.scenario.cadence,
    createdAt: simulation.createdAt.toISOString(),
    publishedCount: simulation.publishedCount,
    rowCount: simulation.rowCount,
    maxRows: simulation.input.scenario.maxRows ?? null,
    atCap: simulation.atCap,
    lastPublishedAt: simulation.lastPublishedAt?.toISOString() ?? null,
    lastPayload: simulation.lastPayload,
    lastError: simulation.lastError,
  };
}
