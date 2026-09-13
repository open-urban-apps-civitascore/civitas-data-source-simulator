import { Activity } from "lucide-react";

import { MobileNavTrigger } from "@/components/layout/app-shell";
import { generatorHealth } from "@/lib/server/generator";

export async function AppHeader({
  breadcrumb,
  action,
}: {
  breadcrumb: React.ReactNode;
  action?: React.ReactNode;
}) {
  const health = await generatorHealth();

  return (
    <header className="sticky top-0 z-10 flex h-13 shrink-0 items-center justify-between border-b bg-background px-4 py-2">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
        <MobileNavTrigger />
        <Activity className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
        <span className="truncate">{breadcrumb}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {action}
        <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
          <span className={`size-1.5 rounded-full ${health ? "bg-success" : "bg-error"}`} />
          <span className="hidden sm:inline">
            {health ? `Generator verbunden · ${health.simulations} Simulationen` : "Generator nicht erreichbar"}
          </span>
        </span>
      </div>
    </header>
  );
}
