import type { SimulationInput } from "./types.js";

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
