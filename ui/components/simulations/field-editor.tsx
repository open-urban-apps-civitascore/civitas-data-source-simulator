"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CheckedField } from "@/components/ui/checked-field";
import { Field, Input, Select } from "@/components/ui/input";
import { ListInput, NumberInput, ScalarInput } from "@/components/ui/parsed-input";
import { defaultSpec } from "@/lib/describe";
import { parseNumber, parseScalar } from "@/lib/numbers";
import { specErrors, type SpecErrors } from "@/lib/spec-checks";
import { GENERATOR_KINDS, type FieldSpec, type GeneratorSpec } from "@/lib/types";

/** A setting the generator cannot do without: emptied, it is NaN, and the check names it. */
const required = (value: number | undefined) => value ?? Number.NaN;

/** An hour that does not read as a number stays in the list as NaN, so the check can name it. */
const parseHour = (item: string) => parseNumber(item) ?? Number.NaN;

export function FieldEditor({
  field,
  isPrimaryKey,
  showErrors = false,
  onChange,
  onRemove,
}: {
  field: FieldSpec;
  isPrimaryKey: boolean;
  /** After a save attempt every error shows, not only those of inputs already left. */
  showErrors?: boolean;
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

      <SpecParams spec={spec} onChange={setSpec} showErrors={showErrors} />
    </div>
  );
}

function SpecParams({
  spec,
  onChange,
  showErrors,
}: {
  spec: GeneratorSpec;
  onChange: (next: GeneratorSpec) => void;
  showErrors: boolean;
}) {
  const errors = specErrors(spec);
  const check = (key: keyof SpecErrors) => ({ error: errors[key], showError: showErrors });

  switch (spec.kind) {
    case "now":
      return null;
    case "constant":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Wert" hint="Zahlen (auch mit Komma) und true/false werden als solche gesendet.">
            <ScalarInput value={spec.value} onValueChange={(value) => onChange({ ...spec, value })} />
          </Field>
        </div>
      );
    case "enum":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <CheckedField
            label="Werte"
            hint="Durch Komma oder Semikolon getrennt, z. B. Lindenweg, Bremer Platz. Dezimalzahlen mit Punkt."
            className="sm:col-span-2"
            {...check("values")}
          >
            {(invalid) => (
              <ListInput
                values={spec.values}
                parseItem={parseScalar}
                invalid={invalid}
                onValuesChange={(values) => onChange({ ...spec, values })}
              />
            )}
          </CheckedField>
        </div>
      );
    case "randomWalk":
      return (
        <div className="grid gap-3 sm:grid-cols-5">
          <CheckedField label="Min" {...check("min")}>
            {(invalid) => (
              <NumberInput
                value={spec.min}
                integer={spec.integer}
                invalid={invalid}
                onValueChange={(value) => onChange({ ...spec, min: required(value) })}
              />
            )}
          </CheckedField>
          <CheckedField label="Max" {...check("max")}>
            {(invalid) => (
              <NumberInput
                value={spec.max}
                integer={spec.integer}
                invalid={invalid}
                onValueChange={(value) => onChange({ ...spec, max: required(value) })}
              />
            )}
          </CheckedField>
          {/* Fractions stay allowed with "Ganzzahl": the walk moves by them, only what it sends is rounded. */}
          <CheckedField label="Schritt" hint="Max. Änderung pro Tick" {...check("step")}>
            {(invalid) => (
              <NumberInput
                value={spec.step}
                invalid={invalid}
                onValueChange={(value) => onChange({ ...spec, step: required(value) })}
              />
            )}
          </CheckedField>
          <CheckedField label="Startwert" hint="Leer: in der Mitte" {...check("start")}>
            {(invalid) => (
              <NumberInput
                value={spec.start}
                integer={spec.integer}
                invalid={invalid}
                onValueChange={(value) => onChange({ ...spec, start: value })}
              />
            )}
          </CheckedField>
          <IntegerToggle checked={spec.integer ?? false} onChange={(integer) => onChange({ ...spec, integer })} />
        </div>
      );
    case "dailyProfile":
      return (
        <div className="grid gap-3 sm:grid-cols-5">
          <CheckedField label="Min (nachts)" {...check("min")}>
            {(invalid) => (
              <NumberInput
                value={spec.min}
                integer={spec.integer}
                invalid={invalid}
                onValueChange={(value) => onChange({ ...spec, min: required(value) })}
              />
            )}
          </CheckedField>
          <CheckedField label="Max (Spitze)" {...check("max")}>
            {(invalid) => (
              <NumberInput
                value={spec.max}
                integer={spec.integer}
                invalid={invalid}
                onValueChange={(value) => onChange({ ...spec, max: required(value) })}
              />
            )}
          </CheckedField>
          <CheckedField label="Spitzenstunden" hint="0 bis 23, durch Komma oder Semikolon getrennt" {...check("peakHours")}>
            {(invalid) => (
              <ListInput
                values={spec.peakHours}
                parseItem={parseHour}
                formatItem={(hour) => (Number.isNaN(hour) ? "" : String(hour))}
                inputMode="decimal"
                invalid={invalid}
                onValuesChange={(peakHours) => onChange({ ...spec, peakHours })}
              />
            )}
          </CheckedField>
          <CheckedField label="Rauschen" hint="0 = glatt, 1 = wild" {...check("noise")}>
            {(invalid) => (
              <NumberInput
                value={spec.noise}
                placeholder="0,1"
                invalid={invalid}
                onValueChange={(value) => onChange({ ...spec, noise: value })}
              />
            )}
          </CheckedField>
          <IntegerToggle checked={spec.integer ?? false} onChange={(integer) => onChange({ ...spec, integer })} />
        </div>
      );
    case "sequence":
      return (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Präfix">
            <Input value={spec.prefix} onChange={(e) => onChange({ ...spec, prefix: e.target.value })} className="font-mono" />
          </Field>
          <CheckedField label="Start" {...check("start")}>
            {(invalid) => (
              <NumberInput
                value={spec.start}
                integer
                placeholder="1"
                invalid={invalid}
                onValueChange={(value) => onChange({ ...spec, start: value })}
              />
            )}
          </CheckedField>
          <CheckedField label="Stellen auffüllen" hint="0 = keine führenden Nullen" {...check("padTo")}>
            {(invalid) => (
              <NumberInput
                value={spec.padTo}
                integer
                placeholder="0"
                invalid={invalid}
                onValueChange={(value) => onChange({ ...spec, padTo: value })}
              />
            )}
          </CheckedField>
        </div>
      );
    case "jitter":
      return (
        <div className="grid gap-3 sm:grid-cols-4">
          <CheckedField label="Mittelpunkt" {...check("center")}>
            {(invalid) => (
              <NumberInput
                value={spec.center}
                invalid={invalid}
                onValueChange={(value) => onChange({ ...spec, center: required(value) })}
              />
            )}
          </CheckedField>
          <CheckedField label="Streuung ±" {...check("spread")}>
            {(invalid) => (
              <NumberInput
                value={spec.spread}
                invalid={invalid}
                onValueChange={(value) => onChange({ ...spec, spread: required(value) })}
              />
            )}
          </CheckedField>
          <CheckedField label="Nachkommastellen" {...check("precision")}>
            {(invalid) => (
              <NumberInput
                value={spec.precision}
                integer
                placeholder="6"
                invalid={invalid}
                onValueChange={(value) => onChange({ ...spec, precision: value })}
              />
            )}
          </CheckedField>
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
