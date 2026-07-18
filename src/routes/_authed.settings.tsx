import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/settings")({
  head: () => ({ meta: [{ title: "Settings — Autoscript Panel" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: s } = useQuery({ queryKey: ["status"], queryFn: () => api.system.status() });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="p-6">
        <h3 className="text-sm font-medium">Panel</h3>
        <p className="mb-4 text-xs text-muted-foreground">Read-only. Change these by re-running the installer.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Domain" value="panel.example.com" />
          <Field label="TLS mode" value="Single (Let's Encrypt)" />
          <Field label="Agent" value="127.0.0.1:8088" />
          <Field label="DB path" value="/etc/autoscript/db.sqlite" />
          <Field label="Hostname" value={s?.hostname} />
          <Field label="IPv4" value={s?.ipv4} />
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-medium">Change admin password</h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Current</Label>
            <Input type="password" />
          </div>
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input type="password" />
          </div>
        </div>
        <Button className="mt-4" onClick={() => toast.success("Password updated")}>Update password</Button>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-medium text-destructive">Danger zone</h3>
        <p className="mt-1 mb-3 text-xs text-muted-foreground">Reissue TLS certs or restart core services.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => toast.success("Renewal queued")}>Renew certificates</Button>
          <Button variant="outline" onClick={() => toast.success("xray restarted")}>Restart xray</Button>
          <Button variant="outline" onClick={() => toast.success("Agent restarted")}>Restart agent</Button>
          <Separator />
        </div>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">{value ?? "—"}</div>
    </div>
  );
}
