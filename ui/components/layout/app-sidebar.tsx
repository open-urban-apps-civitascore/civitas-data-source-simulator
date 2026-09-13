import Link from "next/link";
import { Activity, Database, FileQuestion, LogOut } from "lucide-react";

import { signOut } from "@/auth";
import { Logo } from "@/components/brand/logo";
import { NavLink } from "@/components/layout/nav-link";
import { listSimulations } from "@/lib/server/generator";
import { authDisabled, currentUser } from "@/lib/server/session";

function initialsOf(label: string): string {
  const parts = label.replace(/@.*$/, "").split(/[.\s_-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export async function AppSidebar() {
  // An unreachable generator degrades the counter, not the navigation.
  const [simulations, user] = await Promise.all([
    listSimulations().catch(() => []),
    currentUser(),
  ]);
  const active = simulations.filter((s) => s.enabled).length;
  const label = user?.name || user?.email || (authDisabled() ? "Ohne Anmeldung" : "Unbekannt");

  return (
    <nav
      aria-label="Hauptnavigation"
      className="flex h-full w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:h-svh"
    >
      <div className="flex items-center gap-2.5 p-3">
        <Logo className="size-9 shrink-0" />
        <div className="grid leading-tight">
          <span className="truncate text-sm font-semibold">Datensimulator</span>
          <span className="truncate text-xs text-muted-foreground">CIVITAS/CORE Add-on</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 py-3">
        <div className="flex flex-col gap-1">
          <span className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Simulator
          </span>
          <NavLink href="/simulations">
            <Activity className="size-4 shrink-0" />
            <span className="truncate">Simulationen</span>
            <span className="ml-auto rounded bg-muted px-1.5 text-xs text-muted-foreground">
              {active}/{simulations.length}
            </span>
          </NavLink>
          <NavLink href="/datastructures">
            <Database className="size-4 shrink-0" />
            <span className="truncate">Datenstrukturen</span>
          </NavLink>
        </div>
        <div className="flex flex-col gap-1">
          <span className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Hilfe
          </span>
          <NavLink href="/docs">
            <FileQuestion className="size-4 shrink-0" />
            <span className="truncate">Was ist das?</span>
          </NavLink>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t p-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {initialsOf(label)}
          </div>
          <div className="grid min-w-0 leading-tight">
            <span className="truncate text-sm font-medium">{label}</span>
            <span className="truncate text-xs text-muted-foreground">CIVITAS/CORE</span>
          </div>
          {authDisabled() ? null : (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button type="submit" title="Abmelden" className="text-muted-foreground hover:text-foreground">
                <LogOut className="size-4" />
              </button>
            </form>
          )}
        </div>
        {authDisabled() ? (
          <p className="rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
            Anmeldung abgeschaltet (SIMULATOR_SKIP_AUTH)
          </p>
        ) : null}
        <Link href="/docs" className="text-xs text-muted-foreground hover:text-foreground">
          Was macht dieses Add-on?
        </Link>
      </div>
    </nav>
  );
}
