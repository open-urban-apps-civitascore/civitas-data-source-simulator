"use client";

import { useState } from "react";

import { Field } from "@/components/ui/input";

/**
 * A field that checks its value. The error waits until the person has left the
 * input — nobody should be told off for a number they are halfway through — or
 * until a save shows every error at once.
 */
export function CheckedField({
  error,
  showError = false,
  children,
  ...field
}: Omit<React.ComponentProps<typeof Field>, "children"> & {
  showError?: boolean;
  children: (invalid: boolean) => React.ReactNode;
}) {
  const [left, setLeft] = useState(false);
  const visible = error && (left || showError) ? error : undefined;
  return (
    <Field {...field} error={visible}>
      <span className="contents" onBlur={() => setLeft(true)}>
        {children(Boolean(visible))}
      </span>
    </Field>
  );
}
