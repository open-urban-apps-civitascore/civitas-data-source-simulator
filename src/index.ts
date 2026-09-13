import express from "express";
import { z } from "zod";

import { compileScenario } from "./generators.js";
import { Registry, SimulationLimitError, renderSample } from "./registry.js";
import { scenarioSchema, simulationInputSchema } from "./types.js";

// Control plane: REST in (what to generate), MQTT or SQL out (the data).

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

/** Status plus the configuration it was built from, so a UI can edit it. */
app.get("/simulations/:id", (req, res) => {
  const simulation = registry.get(req.params.id);
  if (!simulation) {
    res.status(404).json({ error: "No such simulation." });
    return;
  }
  res.json({ ...simulation, input: registry.getInput(req.params.id) });
});

// PUT, not POST: the caller owns the id, so a retry converges and uninstall
// can DELETE without a lookup table.
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
    // Usually an unreachable broker.
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete("/simulations/:id", async (req, res) => {
  const removed = await registry.remove(req.params.id);
  res.status(removed ? 204 : 404).end();
});

app.post("/simulations/:id/switch_on", async (req, res) => {
  try {
    const simulation = await registry.setEnabled(req.params.id, true);
    if (!simulation) {
      res.status(404).json({ error: "No such simulation." });
      return;
    }
    res.json(simulation);
  } catch (error) {
    // The simulation stays registered and paused, with the reason on it.
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/simulations/:id/switch_off", async (req, res) => {
  try {
    const simulation = await registry.setEnabled(req.params.id, false);
    if (!simulation) {
      res.status(404).json({ error: "No such simulation." });
      return;
    }
    res.json(simulation);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/simulations/:id/sample", (req, res) => {
  const count = Math.min(Number(req.query.count ?? 5) || 5, 50);
  const records = registry.sample(req.params.id, count);
  if (!records) {
    res.status(404).json({ error: "No such simulation." });
    return;
  }
  res.json({ records });
});

/** Render an unregistered scenario, for a preview before anything is installed. */
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

// Clean disconnects rather than keepalive timeouts.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void registry.shutdown().finally(() => server.close(() => process.exit(0)));
  });
}
