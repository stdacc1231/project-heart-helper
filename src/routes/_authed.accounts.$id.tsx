import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { ArrowLeft, Copy, Trash2, Save, Send, ShieldCheck, Wifi, HardDrive, Users, Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { api, formatBytes, PROTOCOL_LABELS, type Account, type ConnectionProfile } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/accounts/$id")({
  head: () => ({ meta: [{ title: "Account — Autoscript Panel" }] }),
  component: AccountDetail,
});

function AccountDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: detail } = useQuery({
    queryKey: ["account-detail", id],
    queryFn: () => api.accounts.detail(id),
    refetchInterval: 4000,
  });

  const data = detail?.account;
  const [f, setF] = useState<Partial<Account>>({});
  useEffect(() => { if (data) setF(data); }, [data]);

  const save = useMutation({
    mutationFn: () => api.accounts.update(id, f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account", id] });
      qc.invalidateQueries({ queryKey: ["account-detail", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Saved");
    },
  });
  const remove = useMutation({
    mutationFn: () => api.accounts.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Deleted");
      navigate({ to: "/accounts" });
    },
  });
  const sendTg = useMutation({
    mutationFn: () => api.accounts.sendTelegram(id),
    onSuccess: () => toast.success("Config sent via Telegram"),
  });

  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const limitBytes = detail?.usage?.limitBytes ?? (data.quotaGb ? data.quotaGb * 1024 ** 3 : 0);
  const remainingBytes = detail?.usage?.remainingBytes ?? Math.max(0, limitBytes - data.usedBytes);
  const profiles = detail?.connectionProfiles ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild><Link to="/accounts"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <h2 className="text-lg font-semibold">{data.username}</h2>
        <Badge variant="outline" className="uppercase">{PROTOCOL_LABELS[data.protocol]}</Badge>
        <Badge>{data.status}</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Metric icon={Globe2} label="Host" value={detail?.host ?? "—"} sub="Protocol domain" />
        <Metric icon={ShieldCheck} label="Login" value={detail?.loginUsername ?? data.username} sub={data.protocol === "ssh" ? "Linux SSH user" : "Client name"} />
        <Metric icon={HardDrive} label="Used" value={formatBytes(data.usedBytes)} sub={limitBytes ? `${formatBytes(remainingBytes)} left` : "Unlimited quota"} />
        <Metric icon={Users} label="IP limit" value={data.ipLimit ? String(data.ipLimit) : "∞"} sub={`${detail?.activeIps?.length ?? data.online} online now`} />
        <Metric icon={Wifi} label="Speed" value={`↓ ${speed(data.speedDnKbps)} / ↑ ${speed(data.speedUpKbps)}`} sub="Mbps" />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric icon={HardDrive} label="Today" value={formatBytes(detail?.traffic?.today ?? 0)} sub="Rx + Tx" />
        <Metric icon={HardDrive} label="This week" value={formatBytes(detail?.traffic?.week ?? 0)} sub="Since Monday" />
        <Metric icon={HardDrive} label="This month" value={formatBytes(detail?.traffic?.month ?? 0)} sub="Since day 1" />
        <Metric icon={HardDrive} label="Last 30 days" value={formatBytes(detail?.traffic?.last30d ?? 0)} sub="Rolling window" />
      </div>


      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium">Details</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Expires</Label>
              <Input type="date" value={f.expiresAt?.slice(0, 10) ?? ""} onChange={(e) => setF({ ...f, expiresAt: new Date(e.target.value).toISOString() })} />
            </div>
            <div className="space-y-1.5">
              <Label>Telegram ID</Label>
              <Input value={f.telegramId ?? ""} onChange={(e) => setF({ ...f, telegramId: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>IP limit</Label>
              <Input type="number" value={f.ipLimit ?? 0} onChange={(e) => setF({ ...f, ipLimit: +e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Quota (GB)</Label>
              <Input type="number" value={f.quotaGb ?? 0} onChange={(e) => setF({ ...f, quotaGb: +e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Down (Mbps)</Label>
              <Input type="number" step="0.1" min="0" value={(f.speedDnKbps ?? 0)/1000} onChange={(e) => setF({ ...f, speedDnKbps: Math.round((+e.target.value) * 1000) })} />
            </div>
            <div className="space-y-1.5">
              <Label>Up (Mbps)</Label>
              <Input type="number" step="0.1" min="0" value={(f.speedUpKbps ?? 0)/1000} onChange={(e) => setF({ ...f, speedUpKbps: Math.round((+e.target.value) * 1000) })} />
            </div>
            {data.protocol === "ssh" && (
              <div className="col-span-2 space-y-1.5">
                <Label>Password</Label>
                <Input value={f.password ?? ""} onChange={(e) => setF({ ...f, password: e.target.value })} />
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-between">
            <Button variant="destructive" onClick={() => confirm("Delete?") && remove.mutate()}>
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
            <Button onClick={() => save.mutate()}>
              <Save className="mr-1 h-4 w-4" /> Save changes
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium">Usage</h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Used" value={formatBytes(data.usedBytes)} />
            <Field label="Quota" value={limitBytes ? formatBytes(limitBytes) : "Unlimited"} />
            <Field label="Remaining" value={limitBytes ? formatBytes(remainingBytes) : "Unlimited"} />
            <Field label="Online now" value={String(data.online)} />
            <Field label="Login user" value={detail?.loginUsername ?? data.username} mono />
            <Field label="Host" value={detail?.host ?? "—"} mono />
            <Field label="Created" value={new Date(data.createdAt).toLocaleString()} />
            <Field label="Expires" value={new Date(data.expiresAt).toLocaleString()} />
            {data.uuid && <Field label="UUID" value={data.uuid} mono />}
            {data.telegramId && <Field label="Telegram ID" value={data.telegramId} mono />}
          </dl>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Online IPs</h3>
            <Badge variant="outline">{detail?.activeIps?.length ?? 0} active</Badge>
          </div>
          {detail?.activeIps?.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {detail.activeIps.map((ip) => (
                <div key={ip.ip} className="rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="font-mono">{ip.ip}</div>
                  <div className="text-xs text-muted-foreground">Last seen {new Date(ip.lastSeen).toLocaleString()}</div>
                </div>
              ))}
            </div>
          ) : <div className="text-sm text-muted-foreground">No active IPs detected right now.</div>}
        </Card>

        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Client config</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(detail?.configLink ?? ""); toast.success("Copied"); }}>
                <Copy className="mr-1 h-4 w-4" /> Copy link
              </Button>
              {data.telegramId && (
                <Button size="sm" onClick={() => sendTg.mutate()} disabled={sendTg.isPending}>
                  <Send className="mr-1 h-4 w-4" /> Send via Telegram
                </Button>
              )}
            </div>
          </div>
          <Input readOnly value={detail?.configLink ?? ""} className="font-mono text-xs" />
          {detail?.configText && (
            <Textarea readOnly value={detail.configText} className="mt-3 font-mono text-xs" rows={8} />
          )}
        </Card>

        <Card className="p-4 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">Connection settings</h3>
              <p className="text-xs text-muted-foreground">
                Featuring ports <span className="font-mono">443</span> (TLS) and <span className="font-mono">80</span> (nTLS).
                Any Cloudflare-compatible port works — clients pick their own.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(detail?.subscriptionUrl ?? ""); toast.success("User status link copied"); }}>
              <Copy className="mr-1 h-4 w-4" /> User status link
            </Button>
          </div>
          {profiles.length === 0 ? (
            <div className="text-sm text-muted-foreground">No connection profiles generated.</div>
          ) : (() => {
            const groups: Record<string, ConnectionProfile[]> = {};
            for (const p of profiles) {
              const key = (p.network || "tcp").toUpperCase();
              (groups[key] ||= []).push(p);
            }
            const order = ["WS", "XHTTP", "TCP"];
            const keys = Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b));
            return (
              <div className="space-y-4">
                {keys.map((k) => (
                  <div key={k}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Transport</span>
                      <Badge variant="secondary" className="mono">{k === "XHTTP" ? "xHTTP" : k}</Badge>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {groups[k].map((p) => <ProfileCard key={`${p.label}-${p.port}`} profile={p} />)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </Card>


      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub: string }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <div className="break-words text-lg font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </Card>
  );
}

function ProfileCard({ profile }: { profile: ConnectionProfile }) {
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  };
  const isTls = profile.security === "tls";
  return (
    <div className={`group relative overflow-hidden rounded-lg border p-3 transition-colors ${isTls ? "border-primary/40 bg-primary/[0.04]" : "border-border/60 bg-muted/25"}`}>
      <div className={`absolute inset-x-0 top-0 h-px ${isTls ? "bg-gradient-to-r from-transparent via-primary to-transparent" : "bg-gradient-to-r from-transparent via-muted-foreground/40 to-transparent"}`} />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isTls ? "default" : "outline"} className="mono uppercase">{isTls ? "TLS" : "nTLS"}</Badge>
          <span className="mono text-xs font-medium">Port {profile.port}</span>
          <span className="mono text-[10px] uppercase tracking-widest text-muted-foreground">{profile.path || "—"}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => copy(profile.link)}><Copy className="mr-1 h-4 w-4" /> Copy</Button>
      </div>
      <div className="break-all rounded border bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{profile.link}</div>
      {profile.text && profile.text !== profile.link && <Textarea readOnly value={profile.text} className="mt-2 font-mono text-[11px]" rows={4} />}
    </div>
  );
}


function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : ""}>{value}</dd>
    </div>
  );
}

function speed(kbps: number) {
  return kbps ? `${(kbps / 1000).toFixed(kbps % 1000 ? 1 : 0)}` : "∞";
}
