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
  head: () => ({ meta: [{ title: "Dashboard — Autoscript Panel" }] }),
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
  const { data: live } = useQuery({ queryKey: ["connections"], queryFn: () => api.connections.list(), refetchInterval: 4000 });


  const online = accounts?.reduce((a, x) => a + x.online, 0) ?? 0;
  const totalUsage = accounts?.reduce((a, x) => a + x.usedBytes, 0) ?? 0;

  const periodRx = (traffic ?? []).reduce((sum, p) => sum + p.rxBytes, 0);
  const periodTx = (traffic ?? []).reduce((sum, p) => sum + p.txBytes, 0);

  const chartData = (traffic ?? []).map((p) => ({
    time: range !== "24h"
      ? new Date(p.t).toLocaleDateString([], { weekday: "short", hour: "2-digit" })
      : new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    rx: +(p.rxBytes / 1024 ** 3).toFixed(2),
    tx: +(p.txBytes / 1024 ** 3).toFixed(2),
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={Activity} label="Uptime" value={s ? formatDuration(s.uptimeSeconds) : "—"} sub={s?.hostname} />
        <Stat icon={Users} label="Users online" value={String(online)} sub={`${accounts?.length ?? 0} total`} />
        <Stat icon={Wifi} label="Network" value={s ? `${s.netRxMbps.toFixed(1)} / ${s.netTxMbps.toFixed(1)} Mbps` : "—"} sub="Rx / Tx" />
        <Stat icon={HardDrive} label="Total account usage" value={formatBytes(totalUsage)} sub="All users" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Stat icon={HardDrive} label={`${RANGE_LABELS[range]} download`} value={formatBytes(periodRx)} sub="Selected period" />
        <Stat icon={HardDrive} label={`${RANGE_LABELS[range]} upload`} value={formatBytes(periodTx)} sub="Selected period" />
        <Stat icon={HardDrive} label={`${RANGE_LABELS[range]} total`} value={formatBytes(periodRx + periodTx)} sub="Download + upload" />
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
                  <stop offset="0%"   stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="tx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="hsl(var(--chart-2, 200 90% 55%))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--chart-2, 200 90% 55%))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} unit=" GB" />
              <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="rx" name="Download" stroke="hsl(var(--primary))" fill="url(#rx)" strokeWidth={2} />
              <Area type="monotone" dataKey="tx" name="Upload"   stroke="hsl(var(--chart-2, 200 90% 55%))" fill="url(#tx)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

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
