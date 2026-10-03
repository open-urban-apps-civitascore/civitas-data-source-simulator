import Link from "next/link";

import { AppHeader } from "@/components/layout/app-header";
import { SimulationEditor } from "@/components/simulations/simulation-editor";
import { findDataStructure } from "@/lib/server/datastructures";
import { getDefaultBrokerUrl } from "@/lib/server/generator";
import { draftFromDataStructure } from "@/lib/suggest";
import { requireSession } from "@/lib/server/session";

/**
 * `?from=<urn>` pre-fills the form. Read on the server: a client hook would need
 * a Suspense boundary, which rendered the editor twice and left the preview's
 * state in the copy nobody sees.
 */
export default async function NewSimulationPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; mode?: string }>;
}) {
  await requireSession();
  const { from, mode } = await searchParams;
  const [ds, brokerUrl] = await Promise.all([findDataStructure(from), getDefaultBrokerUrl()]);

  return (
    <>
      <AppHeader
        breadcrumb={
          <span className="flex items-center gap-1.5">
            <Link href="/simulations" className="text-muted-foreground hover:text-foreground">
              Simulationen
            </Link>
            <span className="text-muted-foreground">/</span>
            <span>Neue Simulation</span>
          </span>
        }
      />
      <SimulationEditor
        key={ds?.urn ?? "blank"}
        initial={ds ? draftFromDataStructure(ds, brokerUrl) : undefined}
        defaultBrokerUrl={brokerUrl}
        fromDataStructure={ds?.name}
        initialMode={mode === "json" ? "json" : "fields"}
      />
    </>
  );
}
