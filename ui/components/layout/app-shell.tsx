"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { cn } from "@/lib/utils";

// Sidebar: permanent column from lg up, off-canvas drawer below.
const DrawerContext = createContext<{ setOpen: (open: boolean) => void }>({
  setOpen: () => {},
});

export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  // Stores the route the drawer was opened on; navigating closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;

  const setOpen = useCallback(
    (next: boolean) => setOpenedOn(next ? pathname : null),
    [pathname],
  );
  const drawer = useMemo(() => ({ setOpen }), [setOpen]);

  return (
    <DrawerContext.Provider value={drawer}>
      <div className="flex">
        {open ? (
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
          />
        ) : null}

        <div
          className={cn(
            "fixed inset-y-0 left-0 z-40 transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          {sidebar}
        </div>

        <main className="flex h-svh min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </DrawerContext.Provider>
  );
}

export function MobileNavTrigger() {
  const { setOpen } = useContext(DrawerContext);
  return (
    <button
      type="button"
      aria-label="Navigation öffnen"
      onClick={() => setOpen(true)}
      className="-ml-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
    >
      <Menu className="size-5" />
    </button>
  );
}
