import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ArrowRight, ServerCog, Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — Autoscript Panel" }] }),
  component: LoginPage,
});

function LoginPage() {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const login = useMutation({
    mutationFn: () => api.auth.login(u, p),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Welcome back");
      navigate({ to: "/" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="relative flex min-h-screen items-center justify-center aurora-bg px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:44px_44px] opacity-[0.08]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,var(--color-background)_78%)]" />

      <div className="relative grid w-full max-w-5xl gap-8 lg:grid-cols-[1.15fr_1fr] lg:items-center">
        {/* Brand column */}
        <div className="hidden lg:block">
          <div className="mono mb-3 text-[11px] uppercase tracking-[0.3em] text-muted-foreground">Autoscript · Ops Panel</div>
          <h1 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight">
            <span className="aurora-text">Secure VPS control.</span>
            <br />
            One clean panel.
          </h1>
          <p className="mt-4 max-w-md text-sm text-muted-foreground">
            Manage accounts, live traffic, Telegram payments, updates, certificates and service health from your own server.
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3 text-xs">
            {[
              { label: "Services", icon: ServerCog },
              { label: "Traffic", icon: Activity },
              { label: "Updates", icon: RefreshCw },
            ].map(({ label, icon: Icon }) => (
              <div key={label} className="rounded-md border border-border/60 bg-card/40 p-3">
                <Icon className="mb-2 h-4 w-4 text-primary" />
                <div className="mono uppercase tracking-widest text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Form column */}
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-8 backdrop-blur-xl aurora-ring">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-primary via-chart-3 to-accent text-primary-foreground shadow-lg">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="font-display text-lg font-semibold aurora-text">AUTOSCRIPT</div>
              <div className="mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Administrator sign in</div>
            </div>
          </div>

          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); login.mutate(); }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="u" className="mono text-[11px] uppercase tracking-widest text-muted-foreground">Username</Label>
              <Input id="u" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p" className="mono text-[11px] uppercase tracking-widest text-muted-foreground">Password</Label>
              <Input id="p" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required className="h-11" />
            </div>
            <Button type="submit" className="group h-11 w-full text-base font-medium" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : (<>Sign in <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>)}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
