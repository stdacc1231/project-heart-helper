import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — Autoscript Panel" }] }),
  component: LoginPage,
});

function LoginPage() {
  const [u, setU] = useState("admin");
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
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Server className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-semibold">Autoscript Panel</h1>
          <p className="text-sm text-muted-foreground">Sign in to manage your VPS</p>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="u">Username</Label>
            <Input id="u" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p">Password</Label>
            <Input id="p" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Preview mode — any non-empty password works.
          </p>
        </form>
      </Card>
    </div>
  );
}
