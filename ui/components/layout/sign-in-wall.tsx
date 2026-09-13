import { LogIn } from "lucide-react";

import { signIn } from "@/auth";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export function SignInWall() {
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
