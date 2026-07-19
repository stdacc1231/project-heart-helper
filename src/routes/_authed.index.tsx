import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, Cpu, HardDrive, MemoryStick, Wifi, Users, CheckCircle2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { api, formatDuration, formatBytes } from "@/lib/api";

export const Route = createFileRoute("/_authed/")({
  head: () => ({ meta: [{ title: "Dashboard — GRVPN Panel" }] }),
  component: DashboardPage,
});

function Stat({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

type TrafficRange = "24h" | "7d" | "30d" | "365d";

const RANGE_LABELS: Record<TrafficRange, string> = {
  "24h": "Daily",
  "7d": "Weekly",
  "30d": "Monthly",
  "365d": "Yearly",
};

function DashboardPage() {
  const [range, setRange] = useState<TrafficRange>("24h");
  const { data: s } = useQuery({ queryKey: ["status"], queryFn: () => api.system.status(), refetchInterval: 3000 });
  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts.list(), refetchInterval: 5000 });
  const { data: traffic } = useQuery({ queryKey: ["traffic", range], queryFn: () => api.system.traffic(range), refetchInterval: 10000 });
  // Year of daily buckets for the summary strip (today/yesterday/week/month/year + delta).
  const { data: yearly } = useQuery({ queryKey: ["traffic", "365d"], queryFn: () => api.system.traffic("365d"), refetchInterval: 60000 });
  const { data: live } = useQuery({ queryKey: ["connections"], queryFn: () => api.connections.list(), refetchInterval: 4000 });


  const online = accounts?.reduce((a, x) => a + x.online, 0) ?? 0;
  const totalUsage = accounts?.reduce((a, x) => a + x.usedBytes, 0) ?? 0;

  const periodRx = (traffic ?? []).reduce((sum, p) => sum + p.rxBytes, 0);
  const periodTx = (traffic ?? []).reduce((sum, p) => sum + p.txBytes, 0);
  const xrayTotal = (traffic ?? []).reduce((s, p) => s + (p.xrayRxBytes ?? 0) + (p.xrayTxBytes ?? 0), 0);
  const sshTotal  = (traffic ?? []).reduce((s, p) => s + (p.sshRxBytes ?? 0) + (p.sshTxBytes ?? 0), 0);

  // --- Summary strip: today / yesterday / week / month / year + delta ---
  const now = Date.now();
  const DAY = 86400_000;
  const bucketsIn = (from: number, to: number) =>
    (yearly ?? []).filter((p) => {
      const t = new Date(p.t).getTime();
      return t >= from && t < to;
    }).reduce((s, p) => s + p.rxBytes + p.txBytes, 0);

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const todayFrom = startOfToday.getTime();
  const yStart = todayFrom - DAY;
  const todayTotal = bucketsIn(todayFrom, now);
  const yesterdayTotal = bucketsIn(yStart, todayFrom);
  const weekTotal = bucketsIn(now - 7 * DAY, now);
  const monthTotal = bucketsIn(now - 30 * DAY, now);
  const yearTotal = bucketsIn(now - 365 * DAY, now);
  const dayDelta = todayTotal - yesterdayTotal;
  const dayDeltaPct = yesterdayTotal > 0 ? (dayDelta / yesterdayTotal) * 100 : 0;
  const deltaLabel = yesterdayTotal === 0
    ? (todayTotal > 0 ? "▲ new" : "= 0")
    : `${dayDelta >= 0 ? "▲" : "▼"} ${formatBytes(Math.abs(dayDelta))} (${dayDeltaPct >= 0 ? "+" : ""}${dayDeltaPct.toFixed(0)}%)`;

  const chartData = (traffic ?? []).map((p) => ({
    time: range !== "24h"
      ? new Date(p.t).toLocaleDateString([], { weekday: "short", hour: "2-digit" })
      : new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    rx: +(p.rxBytes / 1024 ** 3).toFixed(2),
    tx: +(p.txBytes / 1024 ** 3).toFixed(2),
    xray: +(((p.xrayRxBytes ?? 0) + (p.xrayTxBytes ?? 0)) / 1024 ** 3).toFixed(2),
    ssh: +(((p.sshRxBytes ?? 0) + (p.sshTxBytes ?? 0)) / 1024 ** 3).toFixed(2),
  }));

  // Per-protocol usage snapshot for the current account list
  const perProtocol = (() => {
    const m = new Map<string, number>();
    for (const a of accounts ?? []) m.set(a.protocol, (m.get(a.protocol) ?? 0) + a.usedBytes);
    return Array.from(m.entries())
      .map(([protocol, bytes]) => ({ protocol: protocol.toUpperCase(), gb: +(bytes / 1024 ** 3).toFixed(3), bytes }))
      .sort((a, b) => b.bytes - a.bytes);
  })();


  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={Activity} label="Uptime" value={s ? formatDuration(s.uptimeSeconds) : "—"} sub={s?.hostname} />
        <Stat icon={Users} label="Users online" value={String(live?.length ?? online)} sub={`${accounts?.length ?? 0} total`} />
        <Stat icon={Wifi} label="Network" value={s ? `${s.netRxMbps.toFixed(1)} / ${s.netTxMbps.toFixed(1)} Mbps` : "—"} sub="Rx / Tx" />
        <Stat icon={HardDrive} label="Total account usage" value={formatBytes(totalUsage)} sub="All users" />
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">Online now</h3>
          <Badge variant="outline" className="mono text-[10px]">{live?.length ?? 0} live · refresh 4s</Badge>
        </div>
        {live && live.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {live.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-md border bg-muted/20 p-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.username}</div>
                  <div className="mono text-[11px] text-muted-foreground">{c.protocol.toUpperCase()} · {c.ip}</div>
                </div>
                <div className="mono text-[11px] text-right text-muted-foreground">
                  ↓ {formatBytes(c.rxBytes)}<br />↑ {formatBytes(c.txBytes)}
                </div>
              </div>
            ))}
          </div>
        ) : <div className="text-sm text-muted-foreground">No users are online right now.</div>}
      </Card>

      {/* Usage summary strip — today vs yesterday, plus week/month/year rollups */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat icon={HardDrive} label="Today" value={formatBytes(todayTotal)} sub={`vs yday · ${deltaLabel}`} />
        <Stat icon={HardDrive} label="Yesterday" value={formatBytes(yesterdayTotal)} sub="00:00 – 24:00" />
        <Stat icon={HardDrive} label="Last 7 days" value={formatBytes(weekTotal)} sub="Rolling week" />
        <Stat icon={HardDrive} label="Last 30 days" value={formatBytes(monthTotal)} sub="Rolling month" />
        <Stat icon={HardDrive} label="Last 365 days" value={formatBytes(yearTotal)} sub="Rolling year" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Stat icon={HardDrive} label={`${RANGE_LABELS[range]} download`} value={formatBytes(periodRx)} sub="Selected period" />
        <Stat icon={HardDrive} label={`${RANGE_LABELS[range]} upload`} value={formatBytes(periodTx)} sub="Selected period" />
        <Stat icon={HardDrive} label={`${RANGE_LABELS[range]} total`} value={formatBytes(periodRx + periodTx)} sub="Download + upload" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Stat icon={HardDrive} label={`${RANGE_LABELS[range]} · Xray usage`} value={formatBytes(xrayTotal)} sub="VMess / VLESS / Trojan" />
        <Stat icon={HardDrive} label={`${RANGE_LABELS[range]} · SSH usage`} value={formatBytes(sshTotal)} sub="SSH + SSH-WS" />
      </div>





      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Traffic</h3>
          <Tabs value={range} onValueChange={(v) => setRange(v as any)}>
            <TabsList>
              <TabsTrigger value="24h">Daily</TabsTrigger>
              <TabsTrigger value="7d">Weekly</TabsTrigger>
              <TabsTrigger value="30d">Monthly</TabsTrigger>
              <TabsTrigger value="365d">Yearly</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer>
            <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="rx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="var(--primary)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="tx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="var(--chart-2)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} unit=" GB" />
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="rx" name="Download" stroke="var(--primary)" fill="url(#rx)" strokeWidth={2} />
              <Area type="monotone" dataKey="tx" name="Upload"   stroke="var(--chart-2)" fill="url(#tx)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Xray vs SSH · {RANGE_LABELS[range]}</h3>
            <Badge variant="outline" className="mono text-[10px]">stacked GB</Badge>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="xr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="var(--primary)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="sh" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="var(--chart-2)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} minTickGap={20} />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} unit=" GB" />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="xray" name="Xray" stackId="1" stroke="var(--primary)" fill="url(#xr)" strokeWidth={2} />
                <Area type="monotone" dataKey="ssh"  name="SSH"  stackId="1" stroke="var(--chart-2)" fill="url(#sh)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Usage by protocol</h3>
            <Badge variant="outline" className="mono text-[10px]">{perProtocol.length} protocols</Badge>
          </div>
          {perProtocol.length === 0 ? (
            <div className="text-sm text-muted-foreground">No account usage yet.</div>
          ) : (
            <div className="space-y-2">
              {(() => {
                const max = Math.max(...perProtocol.map((p) => p.bytes), 1);
                return perProtocol.map((p) => (
                  <div key={p.protocol}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="mono">{p.protocol}</span>
                      <span className="mono text-muted-foreground">{formatBytes(p.bytes)}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-muted/40">
                      <div
                        className="h-full rounded bg-primary/70"
                        style={{ width: `${(p.bytes / max) * 100}%` }}
                      />
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
        </Card>
      </div>


      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-4 text-sm font-medium">Resources</h3>
          <div className="space-y-4">
            <ResourceRow icon={Cpu} label="CPU" percent={s?.cpuPercent ?? 0} sub={`${(s?.cpuPercent ?? 0).toFixed(1)}%`} />
            <ResourceRow icon={MemoryStick} label="Memory" percent={s?.memoryPercent ?? 0} sub={`${s?.memoryUsedMb ?? 0} / ${s?.memoryTotalMb ?? 0} MB`} />
            <ResourceRow icon={HardDrive} label="Disk" percent={s?.diskPercent ?? 0} sub={`${s?.diskUsedGb ?? 0} / ${s?.diskTotalGb ?? 0} GB`} />
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-4 text-sm font-medium">Services</h3>
          <div className="space-y-2">
            {s?.services.map((svc) => (
              <div key={svc.name} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="flex items-center gap-2">
                  {svc.running ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-destructive" />}
                  <span className="font-mono text-sm">{svc.name}</span>
                </div>
                <Badge variant={svc.running ? "secondary" : "destructive"}>
                  {svc.running ? "running" : "stopped"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-medium">System</h3>
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <Field label="Hostname" value={s?.hostname} />
          <Field label="OS" value={s?.os} />
          <Field label="Kernel" value={s?.kernel} />
          <Field label="IPv4" value={s?.ipv4} />
        </dl>
      </Card>
    </div>
  );
}

function ResourceRow({ icon: Icon, label, percent, sub }: { icon: any; label: string; percent: number; sub: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {label}
        </span>
        <span className="text-muted-foreground">{sub}</span>
      </div>
      <Progress value={percent} />
    </div>
  );
}
function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value ?? "—"}</dd>
    </div>
  );
}
