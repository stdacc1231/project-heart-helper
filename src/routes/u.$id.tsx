import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Copy, ShieldCheck, Wifi, HardDrive, CalendarClock, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, formatBytes, PROTOCOL_LABELS, type ConnectionProfile } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/u/$id")({
  ssr: false,
  head: () => ({ meta: [{ title: "User status — GR VPN" }] }),
  component: UserStatusPage,
});

function UserStatusPage() {
  const { id } = Route.useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["public-user", id],
    queryFn: () => api.accounts.publicDetail(id),
    refetchInterval: 15000,
  });


  if (isLoading) return <Shell><div className="text-sm text-muted-foreground">Loading account…</div></Shell>;
  if (error || !data) return <Shell><div className="text-sm text-destructive">Account not found.</div></Shell>;

  const a = data.account;
  const limitBytes = a.quotaGb > 0 ? a.quotaGb * 1024 ** 3 : 0;
  const remainBytes = limitBytes > 0 ? Math.max(0, limitBytes - a.usedBytes) : 0;
  const dailyBytes = data.hourly.reduce((sum, p) => sum + p.rxBytes + p.txBytes, 0);
  const monthlyBytes = data.daily.reduce((sum, p) => sum + p.rxBytes + p.txBytes, 0) || a.usedBytes;

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{a.username}</h1>
            <Badge variant="outline" className="mono uppercase">{PROTOCOL_LABELS[a.protocol]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">GR VPN account status and connection details.</p>
        </div>
        <Badge className="capitalize">{a.status}</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Metric icon={CalendarClock} label="Expires" value={new Date(a.expiresAt).toLocaleDateString()} sub={`${data.daysRemaining} days left`} />
        <Metric icon={Users} label="IP limit" value={a.ipLimit ? String(a.ipLimit) : "∞"} sub={`${data.activeIps.length || a.online} online`} />
        <Metric icon={HardDrive} label="Data used" value={formatBytes(a.usedBytes)} sub={a.quotaGb ? `${formatBytes(remainBytes)} left of ${a.quotaGb} GB` : "Unlimited quota"} />
        <Metric icon={Wifi} label="Speed" value={`↓ ${speed(a.speedDnKbps)} / ↑ ${speed(a.speedUpKbps)}`} sub="Mbps" />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Metric icon={HardDrive} label="Today" value={formatBytes(dailyBytes)} sub="Download + upload" />
        <Metric icon={HardDrive} label="This month" value={formatBytes(monthlyBytes)} sub="Download + upload" />
        <Metric icon={ShieldCheck} label="Login user" value={data.loginUsername ?? (a.protocol === "ssh" ? `grvpn-${a.username}` : a.username)} sub="Use this in your client" />
      </div>

      <Card className="mt-4 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Account limits</h2>
          <Badge variant="outline">{data.host ?? "default host"}</Badge>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <Info label="TLS ports" value={(data.tlsPorts ?? []).join(", ") || "443"} />
          <Info label="Plain ports" value={(data.plainPorts ?? []).join(", ") || "80"} />
          <Info label="Online IPs" value={(data.activeIps ?? []).map((x) => x.ip).join(", ") || "None"} />
        </div>
      </Card>

      <Card className="mt-4 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Connection link</h2>
          <Button variant="outline" size="sm" onClick={() => copy(data.configLink, "Link")}><Copy className="mr-1 h-4 w-4" /> Copy</Button>
        </div>
        <div className="break-all rounded-md border bg-muted/40 p-3 font-mono text-xs">{data.configLink}</div>
        {data.configText && <Textarea readOnly value={data.configText} className="mt-3 min-h-32 font-mono text-xs" />}
      </Card>

      <Card className="mt-4 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">All connection settings</h2>
          <Badge variant="outline">{data.connectionProfiles?.length ?? 0} profiles</Badge>
        </div>
        <div className="grid gap-3">
          {(data.connectionProfiles ?? []).map((p) => <ProfileCard key={`${p.label}-${p.port}`} profile={p} />)}
          {!data.connectionProfiles?.length && <div className="text-sm text-muted-foreground">No connection profiles available.</div>}
        </div>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-5xl px-4 py-8">{children}</main>;
}

function Metric({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub: string }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <div className="break-words text-xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-mono text-sm">{value}</div>
    </div>
  );
}

function ProfileCard({ profile }: { profile: ConnectionProfile }) {
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  };
  return (
    <div className="rounded-md border bg-muted/25 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{profile.label}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{profile.host}:{profile.port}{profile.path || ""}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => copy(profile.link)}><Copy className="mr-1 h-4 w-4" /> Copy</Button>
      </div>
      <div className="break-all rounded border bg-background/40 p-2 font-mono text-xs">{profile.link}</div>
    </div>
  );
}

function speed(kbps: number) {
  return kbps ? `${(kbps / 1000).toFixed(kbps % 1000 ? 1 : 0)}` : "∞";
}