import { AlertTriangle, CheckCircle2, Database, PauseCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { SimulationStatus } from "@/lib/types";

export function StatusBadge({ sim }: { sim: SimulationStatus }) {
  if (sim.lastError) {
    return (
      <Badge variant="error">
        <AlertTriangle className="size-3" /> Fehler
      </Badge>
    );
  }
  if (!sim.enabled) {
    return (
      <Badge variant="muted">
        <PauseCircle className="size-3" /> Pausiert
      </Badge>
    );
  }
  if (sim.atCap) {
    return (
      <Badge variant="warn">
        <Database className="size-3" /> {sim.transport === "rest" ? "Liste voll" : "Tabelle voll"}
      </Badge>
    );
  }
  return (
    <Badge variant="success">
      <CheckCircle2 className="size-3" /> Aktiv
    </Badge>
  );
}

export function TransportBadge({ sim }: { sim: SimulationStatus }) {
  if (sim.transport === "mqtt") return <Badge variant="mqtt">MQTT</Badge>;
  return sim.transport === "rest" ? <Badge variant="rest">REST</Badge> : <Badge variant="sql">SQL</Badge>;
}
