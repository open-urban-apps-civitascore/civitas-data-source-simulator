"use client";

import { Trash2 } from "lucide-react";

import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { defaultSpec } from "@/lib/describe";
import { GENERATOR_KINDS, type FieldSpec, type GeneratorSpec } from "@/lib/types";

function parseScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return raw;
}

const num = (e: React.ChangeEvent<HTMLInputElement>) => Number(e.target.value);

export function FieldEditor({
  field,
  isPrimaryKey,
  onChange,
  onRemove,
}: {
  field: FieldSpec;
  isPrimaryKey: boolean;
  onChange: (next: FieldSpec) => void;
  onRemove: () => void;
}) {
  const spec = field.spec;
  const setSpec = (next: GeneratorSpec) => onChange({ ...field, spec: next });
  const kindInfo = GENERATOR_KINDS.find((k) => k.kind === spec.kind);

  return (
    <div className="grid gap-3 rounded-md border bg-background p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
        <Field label="Feldname" hint={isPrimaryKey ? "Primärschlüssel der Tabelle" : "Punktpfad für verschachtelte Felder, z. B. location.lat"}>
          <Input
            value={field.name}
            onChange={(e) => onChange({ ...field, name: e.target.value })}
            className="font-mono"
            placeholder="z. B. vehicleCount"
          />
        </Field>
        <Field label="Generator" hint={kindInfo?.hint}>
          <Select value={spec.kind} onChange={(e) => setSpec(defaultSpec(e.target.value as GeneratorSpec["kind"]))}>
            {GENERATOR_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-start pt-6">
          <Button type="button" variant="ghost" size="icon" onClick={onRemove} title="Feld entfernen">
            <Trash2 />
          </Button>
        </div>
      </div>

      <SpecParams spec={spec} onChange={setSpec} />
    </div>
  );
}

function SpecParams({ spec, onChange }: { spec: GeneratorSpec; onChange: (next: GeneratorSpec) => void }) {
  switch (spec.kind) {
    case "now":
      return null;
    case "constant":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Wert" hint="Zahlen und true/false werden als solche gesendet.">
            <Input value={String(spec.value)} onChange={(e) => onChange({ ...spec, value: parseScalar(e.target.value) })} />
          </Field>
        </div>
      );
    case "enum":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Werte" hint="Kommagetrennt." className="sm:col-span-2">
            <Input
              value={spec.values.join(", ")}
              onChange={(e) =>
                onChange({ ...spec, values: e.target.value.split(",").map((v) => parseScalar(v.trim())).filter((v) => v !== "") })
              }
            />
          </Field>
        </div>
      );
    case "randomWalk":
      return (
        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="Min">
            <Input type="number" value={spec.min} onChange={(e) => onChange({ ...spec, min: num(e) })} />
          </Field>
          <Field label="Max">
            <Input type="number" value={spec.max} onChange={(e) => onChange({ ...spec, max: num(e) })} />
          </Field>
          <Field label="Schritt" hint="Max. Änderung pro Tick">
            <Input type="number" step="any" value={spec.step} onChange={(e) => onChange({ ...spec, step: num(e) })} />
          </Field>
          <Field label="Startwert">
            <Input
              type="number"
              step="any"
              value={spec.start ?? ""}
              onChange={(e) => onChange({ ...spec, start: e.target.value === "" ? undefined : num(e) })}
            />
          </Field>
          <IntegerToggle checked={spec.integer ?? false} onChange={(integer) => onChange({ ...spec, integer })} />
        </div>
      );
    case "dailyProfile":
      return (
        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="Min (nachts)">
            <Input type="number" value={spec.min} onChange={(e) => onChange({ ...spec, min: num(e) })} />
          </Field>
          <Field label="Max (Spitze)">
            <Input type="number" value={spec.max} onChange={(e) => onChange({ ...spec, max: num(e) })} />
          </Field>
          <Field label="Spitzenstunden" hint="Kommagetrennt, 0–23">
            <Input
              value={spec.peakHours.join(", ")}
              onChange={(e) =>
                onChange({
                  ...spec,
                  peakHours: e.target.value
                    .split(",")
                    .map((v) => Number(v.trim()))
                    .filter((v) => Number.isInteger(v) && v >= 0 && v <= 23),
                })
              }
            />
          </Field>
          <Field label="Rauschen" hint="0 = glatt, 1 = wild">
            <Input type="number" step="0.05" min={0} max={1} value={spec.noise} onChange={(e) => onChange({ ...spec, noise: num(e) })} />
          </Field>
          <IntegerToggle checked={spec.integer ?? false} onChange={(integer) => onChange({ ...spec, integer })} />
        </div>
      );
    case "sequence":
      return (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Präfix">
            <Input value={spec.prefix} onChange={(e) => onChange({ ...spec, prefix: e.target.value })} className="font-mono" />
          </Field>
          <Field label="Start">
            <Input type="number" value={spec.start} onChange={(e) => onChange({ ...spec, start: num(e) })} />
          </Field>
          <Field label="Stellen auffüllen" hint="0 = keine führenden Nullen">
            <Input type="number" min={0} max={12} value={spec.padTo} onChange={(e) => onChange({ ...spec, padTo: num(e) })} />
          </Field>
        </div>
      );
    case "jitter":
      return (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Mittelpunkt">
            <Input type="number" step="any" value={spec.center} onChange={(e) => onChange({ ...spec, center: num(e) })} />
          </Field>
          <Field label="Streuung ±">
            <Input type="number" step="any" value={spec.spread} onChange={(e) => onChange({ ...spec, spread: num(e) })} />
          </Field>
          <Field label="Nachkommastellen">
            <Input type="number" min={0} max={12} value={spec.precision} onChange={(e) => onChange({ ...spec, precision: num(e) })} />
          </Field>
        </div>
      );
  }
}

function IntegerToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 pt-7 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-primary" />
      Ganzzahl
    </label>
  );
}
