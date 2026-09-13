import Link from "next/link";

import { AppHeader } from "@/components/layout/app-header";
import { PageBody } from "@/components/layout/page-body";
import { SimulationEditor } from "@/components/simulations/simulation-editor";
import { toDraft } from "@/lib/api-json";
import { getSimulation } from "@/lib/server/generator";

export const dynamic = "force-dynamic";

export default async function EditSimulationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const [{ id }, { mode }] = await Promise.all([params, searchParams]);
  const simulation = await getSimulation(id).catch(() => null);

  if (!simulation?.input) {
    return (
      <>
        <AppHeader breadcrumb="Simulationen" />
        <PageBody>
          <p className="text-sm text-muted-foreground">
            Diese Simulation lässt sich nicht bearbeiten: der Generator kennt sie nicht mehr.{" "}
            <Link href="/simulations" className="underline">
              Zur Liste
            </Link>
          </p>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <AppHeader
        breadcrumb={
          <span className="flex items-center gap-1.5">
            <Link href="/simulations" className="text-muted-foreground hover:text-foreground">
              Simulationen
            </Link>
            <span className="text-muted-foreground">/</span>
            <span>{simulation.name ?? simulation.id} bearbeiten</span>
          </span>
        }
      />
      <SimulationEditor
        id={id}
        initial={toDraft(simulation.input)}
        initialMode={mode === "json" ? "json" : "fields"}
      />
    </>
  );
}
