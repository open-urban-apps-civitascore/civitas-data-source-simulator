import { compileScenario } from "./generators.js";
import { createPublisher, type Publisher } from "./publisher.js";
import type { SimulationInput } from "./types.js";

/**
 * The set of running simulations, held IN MEMORY only.
 *
 * Deliberately stateless: the marketplace already holds the install records, so
 * persisting them here would be a second copy of the same truth — and two copies
 * eventually disagree. After a restart this registry is empty and the marketplace
 * re-registers what should be running.
 */

export interface SimulationStatus {
  id: string;
  enabled: boolean;
  topic: string;
  url: string;
  intervalSeconds: number;
  createdAt: string;
  publishedCount: number;
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
  timer: NodeJS.Timeout | null;
  publishedCount: number;
  lastPublishedAt: Date | null;
  lastPayload: Record<string, unknown> | null;
  lastError: string | null;
}

/** A demo tool must not be able to flood a municipal broker. */
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
      timer: null,
      publishedCount: 0,
      lastPublishedAt: null,
      lastPayload: null,
      lastError: null,
    };
    this.simulations.set(id, simulation);

    if (input.enabled) await this.start(simulation);
    return toStatus(simulation);
  }

  get(id: string): SimulationStatus | null {
    const simulation = this.simulations.get(id);
    return simulation ? toStatus(simulation) : null;
  }

  list(): SimulationStatus[] {
    return [...this.simulations.values()].map(toStatus);
  }

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
    simulation.publisher = await createPublisher({
      url: simulation.input.transport.url,
      topic: simulation.input.transport.topic,
      // Unique per simulation — see publisher.ts on why a shared id breaks silently.
      clientId: `civitas-demo-generator-${simulation.id}`,
    });
    simulation.lastError = null;

    const tick = async () => {
      const payload = simulation.render(this.now());
      try {
        await simulation.publisher?.publish(payload);
        simulation.publishedCount += 1;
        simulation.lastPublishedAt = this.now();
        simulation.lastPayload = payload;
        simulation.lastError = null;
      } catch (error) {
        // Keep the timer running: brokers come back, and a simulation that gives
        // up on the first blip would need a manual restart nobody would notice.
        simulation.lastError = error instanceof Error ? error.message : String(error);
      }
    };

    void tick();
    simulation.timer = setInterval(tick, simulation.input.scenario.intervalSeconds * 1000);
  }

  private async teardown(simulation: Simulation): Promise<void> {
    if (simulation.timer) clearInterval(simulation.timer);
    simulation.timer = null;
    await simulation.publisher?.close().catch(() => undefined);
    simulation.publisher = null;
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
  return {
    id: simulation.id,
    enabled: simulation.input.enabled,
    topic: simulation.input.transport.topic,
    url: simulation.input.transport.url,
    intervalSeconds: simulation.input.scenario.intervalSeconds,
    createdAt: simulation.createdAt.toISOString(),
    publishedCount: simulation.publishedCount,
    lastPublishedAt: simulation.lastPublishedAt?.toISOString() ?? null,
    lastPayload: simulation.lastPayload,
    lastError: simulation.lastError,
  };
}
