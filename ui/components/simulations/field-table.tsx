import { Key } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { COLUMN_TYPE_LABEL, derivedType, describeSpec } from "@/lib/describe";
import { GENERATOR_KINDS, type Scenario } from "@/lib/types";

const kindLabel = (kind: string) => GENERATOR_KINDS.find((k) => k.kind === kind)?.label ?? kind;

export function FieldTable({ scenario }: { scenario: Scenario }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Feld</th>
            <th className="px-4 py-2 font-medium">Typ</th>
            <th className="px-4 py-2 font-medium">Generator</th>
            <th className="px-4 py-2 font-medium">Wertebereich</th>
          </tr>
        </thead>
        <tbody>
          {scenario.fields.map((field) => (
            <tr key={field.name} className="border-t">
              <td className="px-4 py-2 font-mono text-xs">
                <span className="flex items-center gap-1.5">
                  {field.name}
                  {scenario.primaryKey === field.name ? (
                    <Key className="size-3 text-muted-foreground" aria-label="Primärschlüssel" />
                  ) : null}
                </span>
              </td>
              <td className="px-4 py-2">
                <Badge variant="outline">{COLUMN_TYPE_LABEL[derivedType(field.spec)]}</Badge>
              </td>
              <td className="px-4 py-2">{kindLabel(field.spec.kind)}</td>
              <td className="px-4 py-2 text-muted-foreground">{describeSpec(field.spec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
