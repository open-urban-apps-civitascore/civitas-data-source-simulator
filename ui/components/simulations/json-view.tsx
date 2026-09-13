"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

export function JsonView({ json, id }: { json: string; id?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10">
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? <Check /> : <Copy />} {copied ? "Kopiert" : "Kopieren"}
        </Button>
      </div>
      {id ? (
        <div className="border-b bg-muted/40 px-4 py-2 font-mono text-xs text-muted-foreground">
          PUT /simulations/{id}
        </div>
      ) : null}
      <pre className="max-h-[36rem] overflow-auto bg-foreground/95 p-4 font-mono text-xs leading-relaxed text-background/90">
        {json}
      </pre>
    </div>
  );
}
