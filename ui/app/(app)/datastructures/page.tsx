import { AppHeader } from "@/components/layout/app-header";
import { DataStructureList } from "@/components/datastructures/datastructure-list";
import { getDataStructures } from "@/lib/server/datastructures";
import { listSimulations } from "@/lib/server/generator";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function DataStructuresPage() {
  await requireSession();
  const [{ structures, source, notice }, simulations] = await Promise.all([
    getDataStructures(),
    listSimulations().catch(() => []),
  ]);
  return (
    <>
      <AppHeader breadcrumb="Datenstrukturen" />
      <DataStructureList
        structures={structures}
        source={source}
        notice={notice}
        simulations={simulations}
      />
    </>
  );
}
