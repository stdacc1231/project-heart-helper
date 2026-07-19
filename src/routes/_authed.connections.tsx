import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, formatBytes, PROTOCOL_LABELS } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/connections")({
  head: () => ({ meta: [{ title: "Live connections — Autoscript" }] }),
  component: LivePage,
});

function LivePage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["connections"],
    queryFn: () => api.connections.list(),
    refetchInterval: 4000,
  });
  const kick = useMutation({
    mutationFn: (id: string) => api.connections.kick(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["connections"] }); toast.success("Connection dropped"); },
  });

  const rows = data ?? [];
  const totalRx = rows.reduce((s, r) => s + r.rxBytes, 0);
  const totalTx = rows.reduce((s, r) => s + r.txBytes, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label="Active connections" value={String(rows.length)} accent="primary" />
        <StatCard label="Downstream now"    value={formatBytes(totalRx) + "/s"} accent="chart-3" />
        <StatCard label="Upstream now"      value={formatBytes(totalTx) + "/s"} accent="accent" />
      </div>

      <Card className="overflow-hidden border-border/60 bg-card/70 backdrop-blur">
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <Activity className="h-4 w-4 text-primary" />
          <div className="font-display text-sm font-semibold">Live sessions</div>
          <span className="mono ml-auto text-[10px] uppercase tracking-widest text-muted-foreground">refresh 4s</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Protocol</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>Live speed</TableHead>
              <TableHead>Rx / Tx</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.username}</TableCell>
                <TableCell><Badge variant="outline" className="mono uppercase">{PROTOCOL_LABELS[r.protocol]}</Badge></TableCell>
                <TableCell className="mono text-xs">{r.ip}</TableCell>
                <TableCell className="text-xs">{r.country}{r.city ? ` · ${r.city}` : ""}</TableCell>
                <TableCell className="text-xs">{r.device}</TableCell>
                <TableCell className="mono text-xs">↓ {fmtBps(r.downBps ?? 0)} · ↑ {fmtBps(r.upBps ?? 0)}</TableCell>
                <TableCell className="mono text-xs">↓ {formatBytes(r.rxBytes)} · ↑ {formatBytes(r.txBytes)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => kick.mutate(r.id)}>
                    <X className="mr-1 h-3.5 w-3.5" /> Kick
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">No active sessions.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: "primary" | "accent" | "chart-3" }) {
  return (
    <Card className="relative overflow-hidden border-border/60 bg-card/70 p-5 backdrop-blur">
      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-${accent} to-transparent opacity-60`} />
      <div className="mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-3xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

function fmtBps(bps: number) {
  if (!bps || bps < 1) return "0 bps";
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  let i = 0; let v = bps;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : v < 100 && i > 0 ? 1 : 0)} ${units[i]}`;
}
