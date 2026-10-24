import express from "express";
import { z } from "zod";

import { createAuthMiddleware, readAuthConfig } from "./auth.js";
import { defaultBrokerUrl, readStateConfig } from "./config.js";
import { errorText } from "./connect-error.js";
import { compileScenario } from "./generators.js";
import { Registry, SimulationLimitError, renderSample, retryDelayMs } from "./registry.js";
import { MemoryStore, PostgresStore } from "./store.js";
import { scenarioSchema, simulationInputSchema } from "./types.js";

// Control plane: REST in (what to generate), MQTT or SQL out (the data).

// Refuses to start without a storage setting, like the issuer check below.
const stateConfig = readStateConfig();
const postgres = stateConfig.kind === "postgres" ? new PostgresStore(stateConfig.dsn) : null;
const registry = new Registry({ store: postgres ?? new MemoryStore() });
/** Until the stored simulations are loaded, only the probes answer. */
let ready = false;

const app = express();
app.use(express.json({ limit: "1mb" }));
// Refuses to start when no issuer is configured, so a deployment that forgets
// it fails loudly instead of quietly accepting everyone.
const authConfig = readAuthConfig();
app.use(createAuthMiddleware(authConfig));

const PORT = Number(process.env.PORT ?? 4300);

app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    ready,
    storage: stateConfig.kind,
    simulations: registry.list().length,
    authenticated: authConfig !== null,
  });
});

// Apart from /healthz, so a slow database delays readiness instead of causing restarts.
app.get("/readyz", (_req, res) => {
  res.status(ready ? 200 : 503).json({ ready });
});

app.use((_req, res, next) => {
  if (ready) {
    next();
    return;
  }
  res.status(503).json({ error: "Der Generator lädt noch die gespeicherten Simulationen." });
});

app.get("/defaults", (_req, res) => {
  res.json({ brokerUrl: defaultBrokerUrl() });
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
    // A refinement's message is written for people; zod's own messages are not.
    const custom = parsed.error.issues.find((issue) => issue.code === z.ZodIssueCode.custom);
    res.status(422).json({ error: custom?.message ?? "Invalid simulation.", details: parsed.error.flatten() });
    return;
  }
  try {
    res.status(200).json(await registry.put(req.params.id, parsed.data));
  } catch (error) {
    if (error instanceof SimulationLimitError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    // Usually an unreachable broker, or a refused save.
    res.status(502).json({ error: errorText(error) });
  }
});

app.delete("/simulations/:id", async (req, res) => {
  try {
    const removed = await registry.remove(req.params.id);
    res.status(removed ? 204 : 404).end();
  } catch (error) {
    // The store refused; the simulation keeps running.
    res.status(502).json({ error: errorText(error) });
  }
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
    res.status(502).json({ error: errorText(error) });
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
    res.status(502).json({ error: errorText(error) });
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

/** Retries: on a fresh install the database starts alongside this service. */
async function loadStoredSimulations(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await postgres?.migrate();
      await registry.resume();
      ready = true;
      return;
    } catch (error) {
      const delay = retryDelayMs(attempt);
      console.error(`[demo-generator] stored simulations not loaded, next try in ${delay / 1000} s: ${errorText(error)}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const server = app.listen(PORT, () => {
  console.log(`[demo-generator] listening on :${PORT}`);
  console.log(
    authConfig
      ? `[demo-generator] bearer tokens required, realm ${authConfig.issuer}`
      : "[demo-generator] NO AUTHENTICATION: anyone who can reach this port may use it",
  );
  console.log(
    postgres
      ? "[demo-generator] settings kept in the database"
      : "[demo-generator] settings kept in memory: a restart forgets every simulation",
  );
});
void loadStoredSimulations();

// Clean disconnects rather than keepalive timeouts.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void registry
      .shutdown()
      .then(() => postgres?.close())
      .catch(() => undefined)
      .finally(() => server.close(() => process.exit(0)));
  });
}
