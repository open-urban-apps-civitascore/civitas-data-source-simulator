import express from "express";
import { z } from "zod";

import { compileScenario } from "./generators.js";
import { Registry, SimulationLimitError, renderSample } from "./registry.js";
import { scenarioSchema, simulationInputSchema } from "./types.js";

/**
 * Control plane for the demo data generator.
 *
 * Two directions of traffic, deliberately separate: REST in (what to generate, per
 * install, decided by the marketplace) and MQTT out (the data itself). MQTT alone
 * cannot carry per-install configuration, which is why this service has an API at
 * all.
 */

const registry = new Registry();
const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 4300);

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", simulations: registry.list().length });
});

app.get("/simulations", (_req, res) => {
  res.json({ simulations: registry.list() });
});

app.get("/simulations/:id", (req, res) => {
  const simulation = registry.get(req.params.id);
  if (!simulation) {
    res.status(404).json({ error: "No such simulation." });
    return;
  }
  res.json(simulation);
});

/**
 * PUT, not POST: the caller owns the id (the marketplace passes its dataset id), so
 * uninstall can DELETE without a lookup table and a retry converges instead of
 * creating a second publisher.
 */
app.put("/simulations/:id", async (req, res) => {
  const parsed = simulationInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Invalid simulation.", details: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(await registry.put(req.params.id, parsed.data));
  } catch (error) {
    if (error instanceof SimulationLimitError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    // Most likely the broker is unreachable. Report it rather than registering a
    // simulation that silently never publishes.
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete("/simulations/:id", async (req, res) => {
  const removed = await registry.remove(req.params.id);
  res.status(removed ? 204 : 404).end();
});

app.post("/simulations/:id/switch_on", async (req, res) => {
  const simulation = await registry.setEnabled(req.params.id, true);
  if (!simulation) {
    res.status(404).json({ error: "No such simulation." });
    return;
  }
  res.json(simulation);
});

app.post("/simulations/:id/switch_off", async (req, res) => {
  const simulation = await registry.setEnabled(req.params.id, false);
  if (!simulation) {
    res.status(404).json({ error: "No such simulation." });
    return;
  }
  res.json(simulation);
});

/** Preview an existing simulation's output without publishing it. */
app.get("/simulations/:id/sample", (req, res) => {
  const count = Math.min(Number(req.query.count ?? 5) || 5, 50);
  const records = registry.sample(req.params.id, count);
  if (!records) {
    res.status(404).json({ error: "No such simulation." });
    return;
  }
  res.json({ records });
});

/**
 * Render a scenario that is not registered — so the marketplace can show "what this
 * data will look like" on a catalogue page, for a use case nobody has installed.
 */
app.post("/sample", (req, res) => {
  const parsed = scenarioSchema.safeParse(req.body?.scenario);
  if (!parsed.success) {
    res.status(422).json({ error: "Invalid scenario.", details: parsed.error.flatten() });
    return;
  }
  const count = Math.min(Number(req.body?.count ?? 5) || 5, 50);
  res.json({
    records: renderSample(compileScenario(parsed.data), count, parsed.data.intervalSeconds, new Date()),
  });
});

const server = app.listen(PORT, () => {
  console.log(`[demo-generator] listening on :${PORT}`);
});

// Stop publishers before the process dies, so the broker sees clean disconnects
// rather than keepalive timeouts.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void registry.shutdown().finally(() => server.close(() => process.exit(0)));
  });
}
