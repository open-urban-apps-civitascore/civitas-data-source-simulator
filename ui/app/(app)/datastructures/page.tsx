import { AppHeader } from "@/components/layout/app-header";
import { DataStructureList } from "@/components/datastructures/datastructure-list";
import { listSimulations } from "@/lib/server/generator";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function DataStructuresPage() {
  await requireSession();
  const simulations = await listSimulations().catch(() => []);
  return (
    <>
      <AppHeader breadcrumb="Datenstrukturen" />
      <DataStructureList simulations={simulations} />
    </>
  );
}
