import { AppHeader } from "@/components/layout/app-header";
import { DataStructureList } from "@/components/datastructures/datastructure-list";
import { listSimulations } from "@/lib/server/generator";

export const dynamic = "force-dynamic";

export default async function DataStructuresPage() {
  const simulations = await listSimulations().catch(() => []);
  return (
    <>
      <AppHeader breadcrumb="Datenstrukturen" />
      <DataStructureList simulations={simulations} />
    </>
  );
}
