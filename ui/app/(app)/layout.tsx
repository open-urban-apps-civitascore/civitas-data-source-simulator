import { AppShell } from "@/components/layout/app-shell";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SignInWall } from "@/components/layout/sign-in-wall";
import { isAuthorised } from "@/lib/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthorised())) return <SignInWall />;
  return <AppShell sidebar={<AppSidebar />}>{children}</AppShell>;
}
