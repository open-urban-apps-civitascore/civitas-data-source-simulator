import { AppShell } from "@/components/layout/app-shell";
import { AppSidebar } from "@/components/layout/app-sidebar";

/**
 * Frame only. The sign-in check lives on each page: layouts are cached on the
 * client and do not re-render when navigating between routes that share them,
 * so a guard here would not run again after the first load.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell sidebar={<AppSidebar />}>{children}</AppShell>;
}
