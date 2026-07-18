import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type PanelSettings } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/settings")({
  head: () => ({ meta: [{ title: "Settings — Autoscript Panel" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: s } = useQuery({ queryKey: ["status"], queryFn: () => api.system.status() });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => api.settings.get() });
  const [f, setF] = useState<Partial<PanelSettings>>({});
  useEffect(() => { if (settings) setF(settings); }, [settings]);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () => api.settings.save(f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved. Nginx and TLS will be re-applied.");
    },
  });
  const [pwd, setPwd] = useState({ current: "", next: "" });
  const changePwd = useMutation({
    mutationFn: () => api.settings.changePassword(pwd.current, pwd.next),
    onSuccess: () => { toast.success("Password updated"); setPwd({ current: "", next: "" }); },
  });
  const restart = (svc: string) => api.system.restartService(svc).then(() => toast.success(`${svc} restarted`));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="p-6 space-y-3">
        <h3 className="text-sm font-medium">Panel</h3>
        <p className="text-xs text-muted-foreground">Changing domain or port re-issues TLS and reloads Nginx.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Panel domain</Label>
            <Input value={f.domain ?? ""} onChange={(e) => setF({ ...f, domain: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Port</Label>
            <Input type="number" value={f.port ?? 443} onChange={(e) => setF({ ...f, port: +e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>TLS mode</Label>
            <Select value={f.tlsMode} onValueChange={(v) => setF({ ...f, tlsMode: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single domain (HTTP-01)</SelectItem>
                <SelectItem value="wildcard">Wildcard (DNS-01)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {f.tlsMode === "wildcard" && (
            <>
              <div className="space-y-1.5">
                <Label>Root domain</Label>
                <Input value={f.rootDomain ?? ""} onChange={(e) => setF({ ...f, rootDomain: e.target.value })} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>acme.sh DNS module</Label>
                <Input placeholder="dns_cf" value={f.dnsProvider ?? ""} onChange={(e) => setF({ ...f, dnsProvider: e.target.value })} />
                <p className="text-xs text-muted-foreground">Set provider API keys as environment secrets on the VPS.</p>
              </div>
            </>
          )}
          <div className="space-y-1.5 col-span-2">
            <Label>Update repo (self-update source)</Label>
            <Input value={f.repoUrl ?? ""} onChange={(e) => setF({ ...f, repoUrl: e.target.value })} />
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Apply</Button>
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <h3 className="text-sm font-medium">System</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Hostname" value={s?.hostname} />
          <Field label="IPv4" value={s?.ipv4} />
          <Field label="DB path" value={f.dbPath} />
          <Field label="Agent" value="127.0.0.1:8088" />
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-medium">Change admin password</h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Current</Label>
            <Input type="password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} />
          </div>
        </div>
        <Button className="mt-4" onClick={() => changePwd.mutate()} disabled={!pwd.current || !pwd.next}>Update password</Button>
      </Card>

      <Card className="p-6">
        <h3 className="text-sm font-medium text-destructive">Danger zone</h3>
        <p className="mt-1 mb-3 text-xs text-muted-foreground">Reissue TLS certs or restart core services.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => toast.success("Renewal queued")}>Renew certificates</Button>
          <Button variant="outline" onClick={() => restart("xray")}>Restart xray</Button>
          <Button variant="outline" onClick={() => restart("nginx")}>Restart nginx</Button>
          <Button variant="outline" onClick={() => restart("autoscript-agent")}>Restart agent</Button>
          <Button variant="outline" onClick={() => restart("autoscript-bot")}>Restart bot</Button>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">{value ?? "—"}</div>
    </div>
  );
}
