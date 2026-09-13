import Link from "next/link";
import { Plus } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { SimulationList } from "@/components/simulations/simulation-list";
import { Button } from "@/components/ui/button";
import { listSimulations } from "@/lib/server/generator";

export const dynamic = "force-dynamic";

export default async function SimulationsPage() {
  // First paint from the server; the client polls from there.
  const initial = await listSimulations().catch(() => []);
  return (
    <>
      <AppHeader
        breadcrumb="Simulationen"
        action={
          <Button asChild size="sm">
            <Link href="/simulations/new">
              <Plus /> Neue Simulation
            </Link>
          </Button>
        }
      />
      <SimulationList initial={initial} />
    </>
  );
}
