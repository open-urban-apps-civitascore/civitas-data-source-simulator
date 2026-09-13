import { LogIn } from "lucide-react";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { authDisabled } from "@/lib/server/session";

export default async function LoginPage() {
  if (authDisabled()) redirect("/simulations");
  const session = await auth();
  if (session?.user && !session.error) redirect("/simulations");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <Logo className="size-10" />
          <div className="grid leading-tight">
            <span className="text-sm font-semibold">Datensimulator</span>
            <span className="text-xs text-muted-foreground">CIVITAS/CORE Add-on</span>
          </div>
        </div>
        <h1 className="mb-1 text-lg">Anmelden</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Mit dem Konto der CIVITAS/CORE-Instanz. Die Anmeldung übernimmt Keycloak.
        </p>
        {session?.error ? (
          <p className="mb-4 rounded-md border border-warn/40 bg-warn/20 px-3 py-2 text-sm">
            Die Sitzung ist abgelaufen. Bitte erneut anmelden.
          </p>
        ) : null}
        <form
          action={async () => {
            "use server";
            await signIn("keycloak", { redirectTo: "/simulations" });
          }}
        >
          <Button type="submit" className="w-full">
            <LogIn /> Mit Keycloak anmelden
          </Button>
        </form>
      </div>
    </div>
  );
}
