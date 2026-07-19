import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, PROTOCOL_LABELS, type PanelSettings, type Protocol } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/settings")({
  head: () => ({ meta: [{ title: "Settings — Autoscript Panel" }] }),
  component: SettingsPage,
});

const CF_TLS_PORTS   = [443, 2053, 2083, 2087, 2096, 8443];
const CF_PLAIN_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
const PROTOS: Protocol[] = ["ssh","vmess","vless","trojan"];

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
  const repair = useMutation({
    mutationFn: () => api.system.repairServices(),
    onSuccess: () => toast.success("Repair queued. Xray and SSH-WS will be reinstalled/restarted."),
  });

  const togglePort = (list: "tlsPorts" | "plainPorts", port: number) => {
    const cur = new Set(f[list] ?? []);
    if (cur.has(port)) cur.delete(port); else cur.add(port);
    setF({ ...f, [list]: [...cur].sort((a, b) => a - b) });
  };
  const setEndpoint = (p: Protocol, patch: { host?: string }) => {
    const eps = { ...(f.endpoints ?? {}) };
    eps[p] = { ...(eps[p] ?? {}), ...patch };
    setF({ ...f, endpoints: eps });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="p-6 space-y-3">
        <h3 className="text-sm font-medium">Panel</h3>
        <p className="text-xs text-muted-foreground">Changing domain or TLS mode re-issues certs and reloads Nginx.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Panel main domain</Label>
            <Input value={f.domain ?? ""} onChange={(e) => setF({ ...f, domain: e.target.value })} />
            <p className="text-[11px] text-muted-foreground">Used as the default host for every protocol until overridden below.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Primary HTTPS port</Label>
            <Input type="number" value={f.port ?? 443} onChange={(e) => setF({ ...f, port: +e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>TLS mode</Label>
            <Select value={f.tlsMode} onValueChange={(v) => setF({ ...f, tlsMode: v as PanelSettings["tlsMode"] })}>
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
                <p className="text-xs text-muted-foreground">Provider API keys must be set as env secrets on the VPS.</p>
              </div>
            </>
          )}
          <div className="space-y-1.5 col-span-2">
            <Label>Update repo</Label>
            <Input value={f.repoUrl ?? ""} onChange={(e) => setF({ ...f, repoUrl: e.target.value })} />
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <div>
          <h3 className="text-sm font-medium">Cloudflare multi-port listeners</h3>
          <p className="text-xs text-muted-foreground">
            Nginx binds every enabled port. All protocols work through Cloudflare's proxy on these ports.
            SSH-over-WebSocket stays on path <code className="mono">/</code> with HTTP/1.1.
          </p>
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">TLS ports (https / wss)</div>
          <div className="flex flex-wrap gap-2">
            {CF_TLS_PORTS.map((p) => {
              const on = (f.tlsPorts ?? []).includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePort("tlsPorts", p)}
                  className={`mono rounded-md border px-3 py-1.5 text-xs transition-colors ${
                    on ? "border-primary bg-primary/10 text-primary" : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground"
                  }`}
                >{p}</button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="mb-2 mt-2 text-xs font-medium text-muted-foreground">Plain-HTTP ports (http / ws)</div>
          <div className="flex flex-wrap gap-2">
            {CF_PLAIN_PORTS.map((p) => {
              const on = (f.plainPorts ?? []).includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePort("plainPorts", p)}
                  className={`mono rounded-md border px-3 py-1.5 text-xs transition-colors ${
                    on ? "border-accent bg-accent/10 text-accent" : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground"
                  }`}
                >{p}</button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <div>
          <h3 className="text-sm font-medium">Protocol endpoints</h3>
          <p className="text-xs text-muted-foreground">
            Leave blank to use the panel main domain. Any host you set here is auto-added to the TLS cert on save.
          </p>
        </div>
        <div className="grid gap-2">
          {PROTOS.map((p) => {
            const ep = f.endpoints?.[p] ?? {};
            return (
              <div key={p} className="grid grid-cols-[130px_1fr] items-center gap-2">
                <div className="mono text-xs uppercase text-muted-foreground">{PROTOCOL_LABELS[p]}</div>
                <Input placeholder={f.domain ?? "panel domain"} value={ep.host ?? ""} onChange={(e) => setEndpoint(p, { host: e.target.value })} />
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <div>
          <h3 className="text-sm font-medium">SSH banner &amp; auto-suspend</h3>
          <p className="text-xs text-muted-foreground">
            HTML banner shown to SSH users. Pre-auth clients see server-wide vars; interactive
            logins also get per-user vars. Auto-suspend locks accounts past expiry or over quota
            every 60&nbsp;seconds.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={f.autoSuspend ?? true}
            onChange={(e) => setF({ ...f, autoSuspend: e.target.checked })}
          />
          Auto-suspend expired / over-quota accounts
        </label>
        <div className="space-y-1.5">
          <Label>Banner template (HTML)</Label>
          <textarea
            className="min-h-[220px] w-full rounded-md border bg-background p-2 font-mono text-xs"
            value={f.sshBanner ?? ""}
            onChange={(e) => setF({ ...f, sshBanner: e.target.value })}
            spellCheck={false}
          />
        </div>
        <details className="rounded-md border bg-muted/30 p-3 text-xs">
          <summary className="cursor-pointer font-medium">Available variables</summary>
          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {Object.entries(f.sshBannerVariables ?? {}).map(([k, desc]) => (
              <div key={k} className="flex gap-2">
                <code className="rounded bg-background px-1">{k}</code>
                <span className="text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-muted-foreground">
            Per-user variables (USERNAME, IP_LIMIT, DAYS_LEFT, USED_GB, QUOTA_GB, REMAINING_GB, STATUS,
            EXPIRES) only render for interactive logins — pre-auth banners strip them.
          </p>
        </details>
      </Card>






      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Apply all settings</Button>
      </div>


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
          <Button variant="outline" onClick={() => restart("autoscript-ssh-ws")}>Restart SSH-WS</Button>
          <Button variant="outline" onClick={() => repair.mutate()} disabled={repair.isPending}>Repair VPN services</Button>
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

