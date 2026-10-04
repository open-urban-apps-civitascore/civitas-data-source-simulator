// Values as people type them here: with a decimal comma, through an empty field
// on the way to the next value, and never turned into 0 behind their back.

const decimal = new Intl.NumberFormat("de-DE", { useGrouping: false, maximumFractionDigits: 20 });

/**
 * "8,45" and "8.45" are 8.45; a number on its way ("8,", "-") counts as what it
 * says so far. Empty or incomplete is `undefined`; anything else that is not a
 * number is NaN, so validation can name it rather than a 0 hiding it.
 */
export function parseNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "-") return undefined;
  if (!/^-?(\d+([.,]\d*)?|[.,]\d+)$/.test(trimmed)) return Number.NaN;
  return Number(trimmed.replace(",", "."));
}

/** 8.45 is "8,45"; nothing to show for an empty or broken value. */
export function formatDecimal(value: number | undefined): string {
  return value === undefined || Number.isNaN(value) ? "" : decimal.format(value);
}

/**
 * Equal as values: the same number, or both not a number yet. Empty, a lone
 * minus and broken text are all "no number" — the editor stores them alike, and
 * telling them apart here would wipe the minus someone just typed.
 */
export function sameNumber(a: number | undefined, b: number | undefined): boolean {
  const aIsNumber = a !== undefined && !Number.isNaN(a);
  const bIsNumber = b !== undefined && !Number.isNaN(b);
  return aIsNumber && bIsNumber ? a === b : aIsNumber === bIsNumber;
}

/** A list typed into one field, separated by commas or semicolons; blanks dropped. */
export function splitList(text: string): string[] {
  return text
    .split(/[,;]/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** Numbers and true/false are sent as such, a decimal comma included; anything else as text. */
export function parseScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const number = parseNumber(trimmed);
  return number !== undefined && Number.isFinite(number) ? number : raw;
}

/** How a scalar reads back in its field: a number with its decimal comma. */
export function formatScalar(value: string | number | boolean): string {
  return typeof value === "number" ? formatDecimal(value) : String(value);
}
