import type { GeneratorSpec } from "./types";

// What a generator's settings must satisfy, in one place: the field editor shows
// it under the input, the simulation editor lists it before a save. Messages are
// short because they sit under their input; the list adds field and setting.

export type SpecErrors = Partial<Record<SpecKey, string>>;

type SpecKey = "value" | "values" | "min" | "max" | "step" | "start" | "peakHours" | "noise" | "padTo" | "center" | "spread" | "precision";

export const SPEC_LABELS: Record<SpecKey, string> = {
  value: "Wert",
  values: "Werte",
  min: "Min",
  max: "Max",
  step: "Schritt",
  start: "Start",
  peakHours: "Spitzenstunden",
  noise: "Rauschen",
  padTo: "Stellen auffüllen",
  center: "Mittelpunkt",
  spread: "Streuung",
  precision: "Nachkommastellen",
};

const MISSING = "Bitte eine Zahl eintragen.";
const WHOLE = "Nur ganze Zahlen, weil „Ganzzahl“ gesetzt ist.";

const isNumber = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);

function wholeIn(value: number | undefined, from: number, to: number, message: string): string | undefined {
  if (!isNumber(value)) return MISSING;
  return Number.isInteger(value) && value >= from && value <= to ? undefined : message;
}

/** Min and max of a range; with "Ganzzahl" both are values the field takes, so whole. */
function range(spec: { min: number; max: number; integer?: boolean }, errors: SpecErrors): void {
  for (const key of ["min", "max"] as const) {
    if (!isNumber(spec[key])) errors[key] = MISSING;
    else if (spec.integer && !Number.isInteger(spec[key])) errors[key] = WHOLE;
  }
  if (!errors.min && !errors.max && spec.min > spec.max) errors.max = "Muss mindestens so groß sein wie Min.";
}

export function specErrors(spec: GeneratorSpec): SpecErrors {
  const errors: SpecErrors = {};
  switch (spec.kind) {
    case "constant":
    case "now":
      break;
    case "enum":
      if (spec.values.length === 0) errors.values = "Mindestens ein Wert.";
      break;
    case "randomWalk":
      range(spec, errors);
      // The walk itself may move by fractions; only what it sends is rounded.
      if (!isNumber(spec.step)) errors.step = MISSING;
      else if (spec.step <= 0) errors.step = "Muss größer als 0 sein.";
      if (spec.start !== undefined) {
        if (!isNumber(spec.start)) errors.start = "Keine Zahl.";
        else if (spec.integer && !Number.isInteger(spec.start)) errors.start = WHOLE;
      }
      break;
    case "dailyProfile":
      range(spec, errors);
      if (spec.peakHours.length === 0) errors.peakHours = "Mindestens eine Stunde.";
      else if (spec.peakHours.some((hour) => !Number.isInteger(hour) || hour < 0 || hour > 23)) {
        errors.peakHours = "Nur ganze Stunden von 0 bis 23.";
      }
      if (spec.noise !== undefined) {
        if (!isNumber(spec.noise)) errors.noise = MISSING;
        else if (spec.noise < 0 || spec.noise > 1) errors.noise = "Zwischen 0 und 1.";
      }
      break;
    case "sequence": {
      const start = wholeIn(spec.start ?? 1, 0, Number.MAX_SAFE_INTEGER, "Eine ganze Zahl ab 0.");
      if (start) errors.start = start;
      const padTo = wholeIn(spec.padTo ?? 0, 0, 12, "Eine ganze Zahl von 0 bis 12.");
      if (padTo) errors.padTo = padTo;
      break;
    }
    case "jitter": {
      if (!isNumber(spec.center)) errors.center = MISSING;
      if (!isNumber(spec.spread)) errors.spread = MISSING;
      else if (spec.spread <= 0) errors.spread = "Muss größer als 0 sein.";
      const precision = wholeIn(spec.precision ?? 6, 0, 12, "Eine ganze Zahl von 0 bis 12.");
      if (precision) errors.precision = precision;
      break;
    }
  }
  return errors;
}

/** The same findings as list entries, naming the field and the setting. */
export function specMessages(fieldName: string, spec: GeneratorSpec): string[] {
  const name = fieldName.trim() || "ohne Namen";
  return Object.entries(specErrors(spec)).map(
    ([key, message]) => `Feld „${name}“, ${SPEC_LABELS[key as SpecKey]}: ${message}`,
  );
}
