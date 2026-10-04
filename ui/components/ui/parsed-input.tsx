"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import {
  formatDecimal,
  formatScalar,
  parseNumber,
  parseScalar,
  sameNumber,
  splitList,
} from "@/lib/numbers";
import { cn } from "@/lib/utils";

type InputProps = Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "defaultValue">;

/**
 * An input whose text belongs to the person typing. The parent gets the parsed
 * value on every keystroke, but the text is only rebuilt from the value when the
 * value changed from outside — a reset, the JSON view. Rebuilding on every
 * keystroke is what swallowed a typed comma and turned an emptied field into 0.
 */
function ParsedInput<T>({
  value,
  parse,
  format,
  same,
  onValueChange,
  invalid,
  className,
  ...props
}: InputProps & {
  value: T;
  parse: (text: string) => T;
  format: (value: T) => string;
  same: (a: T, b: T) => boolean;
  onValueChange: (next: T) => void;
  invalid?: boolean;
}) {
  const [text, setText] = useState(() => format(value));
  const [seen, setSeen] = useState(value);
  // Adjusting state to a changed prop during render, the way React recommends
  // over an effect: no frame in which the field shows the stale text.
  if (!same(value, seen)) {
    setSeen(value);
    if (!same(parse(text), value)) setText(format(value));
  }

  return (
    <Input
      {...props}
      type="text"
      autoComplete="off"
      value={text}
      aria-invalid={invalid || undefined}
      className={cn(invalid && "border-error focus-visible:border-error focus-visible:ring-error/30", className)}
      onChange={(event) => {
        setText(event.target.value);
        const next = parse(event.target.value);
        setSeen(next);
        onValueChange(next);
      }}
    />
  );
}

/**
 * A number as people type it here: decimal comma or point, and an empty field
 * on the way to the next value. A text input with a numeric keyboard rather than
 * type="number", which changes the value on scroll and reads a comma
 * differently per browser (the GOV.UK Design System made the same move).
 * `undefined` means empty; NaN means the text is not a number.
 */
export function NumberInput({
  value,
  onValueChange,
  integer = false,
  ...props
}: InputProps & {
  value: number | undefined;
  onValueChange: (next: number | undefined) => void;
  integer?: boolean;
  invalid?: boolean;
}) {
  return (
    <ParsedInput<number | undefined>
      {...props}
      inputMode={integer ? "numeric" : "decimal"}
      value={value}
      parse={parseNumber}
      format={formatDecimal}
      same={sameNumber}
      onValueChange={onValueChange}
    />
  );
}

/**
 * Several values in one field, separated by commas or semicolons. A trailing
 * separator stays where it was typed: the next value is about to follow.
 */
export function ListInput<T>({
  values,
  parseItem,
  formatItem = String,
  onValuesChange,
  ...props
}: InputProps & {
  values: T[];
  parseItem: (item: string) => T;
  formatItem?: (item: T) => string;
  onValuesChange: (next: T[]) => void;
  invalid?: boolean;
}) {
  return (
    <ParsedInput<T[]>
      {...props}
      value={values}
      parse={(text) => splitList(text).map(parseItem)}
      format={(items) => items.map(formatItem).join(", ")}
      same={(a, b) => JSON.stringify(a) === JSON.stringify(b)}
      onValueChange={onValuesChange}
    />
  );
}

/** One value that is sent as a number or true/false when it reads as one, otherwise as text. */
export function ScalarInput({
  value,
  onValueChange,
  ...props
}: InputProps & {
  value: string | number | boolean;
  onValueChange: (next: string | number | boolean) => void;
  invalid?: boolean;
}) {
  return (
    <ParsedInput<string | number | boolean>
      {...props}
      value={value}
      parse={parseScalar}
      format={formatScalar}
      same={Object.is}
      onValueChange={onValueChange}
    />
  );
}
