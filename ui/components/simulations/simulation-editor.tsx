"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Database, Plus, Save } from "lucide-react";

import { PageBody } from "@/components/layout/page-body";
import { FieldEditor } from "@/components/simulations/field-editor";
import { SamplePreview } from "@/components/simulations/sample-preview";
import { ViewToggle } from "@/components/simulations/simulation-detail";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fromJson, toInput, toJson, toScenario } from "@/lib/api-json";
import { createSimulation, saveSimulation } from "@/lib/client";
import type { FieldSpec, SimulationDraft } from "@/lib/types";

const MQTT_FIELDS: FieldSpec[] = [
  { name: "sensorId", spec: { kind: "constant", value: "sensor-001" } },
  { name: "timestamp", spec: { kind: "now" } },
];

/**
 * A table needs a key, and only the running number can produce unique values.
 * Starting a table simulation without one leaves a form that cannot be saved.
 */
const SQL_FIELDS: FieldSpec[] = [
  { name: "id", spec: { kind: "sequence", prefix: "row-", start: 1, padTo: 5 } },
  { name: "erfasst_am", spec: { kind: "now" } },
  { name: "messwert", spec: { kind: "randomWalk", min: 0, max: 100, step: 5, integer: false } },
];

const EMPTY: SimulationDraft = {
  name: "",
  description: "",
  enabled: false,
  transport: { kind: "mqtt", url: "mqtt://civitas-mosquitto:1883", topic: "civitas/" },
  scenario: { intervalSeconds: 10, fields: MQTT_FIELDS },
};

const sameFields = (a: FieldSpec[], b: FieldSpec[]) => JSON.stringify(a) === JSON.stringify(b);

const INTERVAL_PRESETS = [1, 5, 10, 30, 60, 300, 900, 3600];

function validate(draft: SimulationDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Ein Name fehlt.");
  if (draft.transport.kind === "mqtt") {
    if (!draft.transport.url.trim()) errors.push("Die Broker-Adresse fehlt.");
    if (!draft.transport.topic.trim() || draft.transport.topic.trim() === "civitas/") errors.push("Das Topic fehlt.");
  } else {
    if (!draft.transport.table.trim()) errors.push("Der Tabellenname fehlt.");
    if (!draft.scenario.primaryKey) errors.push("Eine SQL-Simulation braucht einen Primärschlüssel.");
    if (!draft.scenario.maxRows) errors.push("Eine SQL-Simulation braucht eine Obergrenze (maxRows).");
    for (const f of draft.scenario.fields) {
      if (f.name.includes(".")) errors.push(`Spaltennamen dürfen keine Punkte enthalten: ${f.name}`);
    }
  }
  if (draft.scenario.fields.length === 0) errors.push("Mindestens ein Feld wird gebraucht.");
  const names = draft.scenario.fields.map((f) => f.name.trim());
  if (names.some((n) => !n)) errors.push("Jedes Feld braucht einen Namen.");
  if (new Set(names).size !== names.length) errors.push("Feldnamen müssen eindeutig sein.");
  if (draft.scenario.intervalSeconds < 1 || draft.scenario.intervalSeconds > 3600) {
    errors.push("Der Takt muss zwischen 1 s und 1 h liegen.");
  }
  return errors;
}

export function SimulationEditor({
  id,
  initial,
  initialMode = "fields",
  fromDataStructure,
}: {
  id?: string;
  initial?: SimulationDraft;
  initialMode?: "fields" | "json";
  /** Portal data structure the fields came from, if any. */
  fromDataStructure?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<SimulationDraft>(initial ?? EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mode, setMode] = useState<"fields" | "json">(initialMode);
  const [jsonText, setJsonText] = useState(() => (initialMode === "json" ? toJson(initial ?? EMPTY) : ""));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonApplied, setJsonApplied] = useState(false);
  const errors = validate(draft);
  const isEdit = Boolean(id);

  const setFields = (fields: FieldSpec[]) => setDraft((d) => ({ ...d, scenario: { ...d.scenario, fields } }));

  const switchMode = (next: "fields" | "json") => {
    if (next === "json") {
      setJsonText(toJson(draft));
      setJsonError(null);
      setJsonApplied(false);
    }
    setMode(next);
  };

  const applyJson = () => {
    try {
      setDraft(fromJson(jsonText));
      setJsonError(null);
      setJsonApplied(true);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : String(error));
      setJsonApplied(false);
    }
  };

  const jsonDirty = mode === "json" && jsonText !== toJson(draft);

  const save = async () => {
    setSubmitted(true);
    setSaveError(null);
    let toSave = draft;
    if (mode === "json") {
      try {
        toSave = fromJson(jsonText);
        setDraft(toSave);
        setJsonError(null);
      } catch (error) {
        setJsonError(error instanceof Error ? error.message : String(error));
        return;
      }
    }
    if (validate(toSave).length > 0) return;

    setSaving(true);
    try {
      const input = toInput(toSave);
      const saved = id ? await saveSimulation(id, input) : await createSimulation(input);
      router.push(`/simulations/${saved.id}`);
      router.refresh();
    } catch (error) {
      // A 502 means the broker or database refused; nothing was registered.
      setSaveError(error instanceof Error ? error.message : String(error));
      setSaving(false);
    }
  };

  /**
   * Swaps the starting fields when they are still untouched, so a table opens
   * ready to save rather than with message-shaped leftovers. Fields the user
   * edited are kept; a table then only gains the key it cannot do without.
   */
  const switchTransport = (kind: "mqtt" | "sql") => {
    setDraft((d) => {
      if (kind === d.transport.kind) return d;

      if (kind === "mqtt") {
        const fields = sameFields(d.scenario.fields, SQL_FIELDS) ? MQTT_FIELDS : d.scenario.fields;
        return {
          ...d,
          transport: { kind: "mqtt", url: "mqtt://civitas-mosquitto:1883", topic: "civitas/" },
          scenario: { ...d.scenario, fields, primaryKey: undefined },
        };
      }

      const untouched = sameFields(d.scenario.fields, MQTT_FIELDS);
      let fields = untouched ? SQL_FIELDS : d.scenario.fields;
      if (!fields.some((f) => f.spec.kind === "sequence")) {
        fields = [SQL_FIELDS[0], ...fields];
      }
      return {
        ...d,
        transport: { kind: "sql", table: "" },
        scenario: {
          ...d.scenario,
          fields,
          primaryKey: fields.find((f) => f.spec.kind === "sequence")?.name,
          seedRows: d.scenario.seedRows ?? 100,
          insertsPerTick: d.scenario.insertsPerTick ?? 1,
          maxRows: d.scenario.maxRows ?? 5000,
        },
      };
    });
  };

  return (
    <PageBody>
      <Link
        href={id ? `/simulations/${id}` : "/simulations"}
        className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Zurück
      </Link>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl">{isEdit ? "Simulation bearbeiten" : "Neue Simulation"}</h1>
        <ViewToggle value={mode} onChange={switchMode} labels={{ fields: "Formular", json: "JSON (Experten)" }} />
      </div>

      {fromDataStructure ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <Database className="size-4 text-muted-foreground" />
          Felder aus der Portal-Datenstruktur <span className="font-medium">{fromDataStructure}</span> vorbelegt. Jeder
          Generator ist ein Vorschlag – anpassen, was nicht passt.
        </div>
      ) : null}

      {saveError ? (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <span className="font-medium">Speichern fehlgeschlagen.</span> <span>{saveError}</span>
          </div>
        </div>
      ) : null}

      {submitted && errors.length > 0 ? (
        <ul className="mb-4 list-disc rounded-md border border-error/40 bg-error/10 px-3 py-2 pl-7 text-sm">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {mode === "json" ? (
          <Card className="flex flex-col overflow-hidden">
            <CardHeader
              title="Konfiguration (JSON)"
              description="Der Body von PUT /simulations/{id}, so wie die Control-API ihn prüft."
              action={
                <Button
                  type="button"
                  variant={jsonDirty ? "default" : "outline"}
                  size="sm"
                  onClick={applyJson}
                  disabled={!jsonDirty && jsonApplied}
                >
                  <Check /> {jsonApplied && !jsonDirty ? "Übernommen" : "Übernehmen"}
                </Button>
              }
            />
            {jsonError ? <div className="border-b border-error/40 bg-error/10 px-4 py-2 text-sm">{jsonError}</div> : null}
            <textarea
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setJsonApplied(false);
              }}
              spellCheck={false}
              aria-label="Konfiguration als JSON"
              className="min-h-[36rem] flex-1 resize-y bg-foreground/95 p-4 font-mono text-xs leading-relaxed text-background/90 outline-none"
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader title="Allgemein" />
              <div className="grid gap-4 px-5 py-4">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Field label="Name">
                    <Input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder="z. B. Verkehrszählung Hauptstraße"
                    />
                  </Field>
                  <Field label="Nach dem Speichern">
                    <label className="flex h-9 items-center gap-2 text-sm">
                      <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
                      {draft.enabled ? "sofort senden" : "pausiert anlegen"}
                    </label>
                  </Field>
                </div>
                <Field label="Beschreibung" hint="Wofür ist diese Simulation da? Erscheint in der Liste.">
                  <Textarea
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </Field>
              </div>
            </Card>

            <Card>
              <CardHeader title="Ziel" description="Wohin die Daten gehen." />
              <div className="grid gap-4 px-5 py-4">
                <div className="flex gap-1 rounded-md bg-muted p-1 text-sm sm:w-fit">
                  {(["mqtt", "sql"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => switchTransport(kind)}
                      className={`rounded px-4 py-1.5 font-medium transition-colors ${
                        draft.transport.kind === kind ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {kind === "mqtt" ? "MQTT-Nachrichten" : "SQL-Tabelle"}
                    </button>
                  ))}
                </div>
                {draft.transport.kind === "mqtt" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Broker" hint="Im Plattform-Netz: mqtt://civitas-mosquitto:1883">
                      <Input
                        value={draft.transport.url}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            transport: {
                              kind: "mqtt",
                              url: e.target.value,
                              topic: draft.transport.kind === "mqtt" ? draft.transport.topic : "",
                            },
                          })
                        }
                        className="font-mono"
                      />
                    </Field>
                    <Field label="Topic" hint="Das Topic, das die Pipeline abonniert.">
                      <Input
                        value={draft.transport.topic}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            transport: {
                              kind: "mqtt",
                              url: draft.transport.kind === "mqtt" ? draft.transport.url : "",
                              topic: e.target.value,
                            },
                          })
                        }
                        className="font-mono"
                      />
                    </Field>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Tabelle"
                      hint="Mit Schema, z. B. kataster.kiez_baeume. Die Datenbank kommt aus der Generator-Konfiguration."
                    >
                      <Input
                        value={draft.transport.table}
                        onChange={(e) => setDraft({ ...draft, transport: { kind: "sql", table: e.target.value } })}
                        className="font-mono"
                      />
                    </Field>
                    <Field label="Primärschlüssel" hint="Nur „Laufende Nummer“ liefert eindeutige Werte.">
                      <Select
                        value={draft.scenario.primaryKey ?? ""}
                        onChange={(e) =>
                          setDraft({ ...draft, scenario: { ...draft.scenario, primaryKey: e.target.value || undefined } })
                        }
                      >
                        <option value="">– wählen –</option>
                        {draft.scenario.fields.map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Zeilen beim Start" hint="Damit die Karte nie leer ist.">
                      <Input
                        type="number"
                        min={0}
                        max={10000}
                        value={draft.scenario.seedRows ?? 0}
                        onChange={(e) =>
                          setDraft({ ...draft, scenario: { ...draft.scenario, seedRows: Number(e.target.value) } })
                        }
                      />
                    </Field>
                    <Field label="Zeilen pro Tick">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={draft.scenario.insertsPerTick ?? 1}
                        onChange={(e) =>
                          setDraft({ ...draft, scenario: { ...draft.scenario, insertsPerTick: Number(e.target.value) } })
                        }
                      />
                    </Field>
                    <Field label="Obergrenze (Zeilen)" hint="Pflicht: jeder Pipeline-Lauf liest die ganze Tabelle.">
                      <Input
                        type="number"
                        min={1}
                        max={100000}
                        value={draft.scenario.maxRows ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            scenario: {
                              ...draft.scenario,
                              maxRows: e.target.value === "" ? undefined : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Takt" description="Wie oft Daten erzeugt werden." />
              <div className="grid gap-3 px-5 py-4">
                <div className="flex flex-wrap gap-1">
                  {INTERVAL_PRESETS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDraft({ ...draft, scenario: { ...draft.scenario, intervalSeconds: s } })}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        draft.scenario.intervalSeconds === s
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-muted"
                      }`}
                    >
                      {s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : "1 h"}
                    </button>
                  ))}
                </div>
                <Field label="Intervall in Sekunden" hint="1 bis 3600." className="sm:w-64">
                  <Input
                    type="number"
                    min={1}
                    max={3600}
                    value={draft.scenario.intervalSeconds}
                    onChange={(e) =>
                      setDraft({ ...draft, scenario: { ...draft.scenario, intervalSeconds: Number(e.target.value) } })
                    }
                  />
                </Field>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Felder"
                description="Jedes Feld der Nachricht bzw. jede Spalte der Zeile und wie ihr Wert entsteht."
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFields([
                        ...draft.scenario.fields,
                        { name: "", spec: { kind: "randomWalk", min: 0, max: 100, step: 5, integer: false } },
                      ])
                    }
                  >
                    <Plus /> Feld
                  </Button>
                }
              />
              <div className="grid gap-3 bg-muted/30 px-5 py-4">
                {draft.scenario.fields.map((field, index) => (
                  <FieldEditor
                    key={index}
                    field={field}
                    isPrimaryKey={draft.scenario.primaryKey === field.name}
                    onChange={(next) => setFields(draft.scenario.fields.map((f, i) => (i === index ? next : f)))}
                    onRemove={() => setFields(draft.scenario.fields.filter((_, i) => i !== index))}
                  />
                ))}
                {draft.scenario.fields.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Noch keine Felder.</p>
                ) : null}
              </div>
            </Card>
          </div>
        )}

        <Card className="flex min-h-[28rem] flex-col overflow-hidden xl:sticky xl:top-0 xl:max-h-[calc(100svh-6rem)]">
          <SamplePreview scenario={toScenario(draft)} />
        </Card>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href={id ? `/simulations/${id}` : "/simulations"}>Abbrechen</Link>
        </Button>
        <Button onClick={() => void save()} disabled={saving}>
          <Save /> {saving ? "Speichern…" : isEdit ? "Speichern" : "Anlegen"}
        </Button>
      </div>
    </PageBody>
  );
}
