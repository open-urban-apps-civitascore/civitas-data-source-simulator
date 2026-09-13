import Link from "next/link";

import { AppHeader } from "@/components/layout/app-header";
import { PageBody } from "@/components/layout/page-body";
import { SimulationDetail } from "@/components/simulations/simulation-detail";
import { getSimulation } from "@/lib/server/generator";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function SimulationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  await requireSession();
  const [{ id }, { view }] = await Promise.all([params, searchParams]);
  const simulation = await getSimulation(id).catch(() => null);

  if (!simulation) {
    return (
      <>
        <AppHeader breadcrumb="Simulationen" />
        <PageBody>
          <p className="text-sm text-muted-foreground">
            Diese Simulation gibt es nicht (mehr).{" "}
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
            <span>{simulation.name ?? simulation.id}</span>
          </span>
        }
      />
      <SimulationDetail initial={simulation} initialView={view === "json" ? "json" : "fields"} />
    </>
  );
}
