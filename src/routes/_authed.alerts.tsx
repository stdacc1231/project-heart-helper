import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/alerts")({
  head: () => ({ meta: [{ title: "Alerts — GRVPN" }] }),
  component: AlertsPage,
});

function AlertsPage() {
  const { data } = useQuery({ queryKey: ["alerts"], queryFn: () => api.alerts.list(), refetchInterval: 15000 });
  const qc = useQueryClient();
  const ack = useMutation({
    mutationFn: (id: string) => api.alerts.ack(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["alerts"] }); toast.success("Alert acknowledged"); },
  });

  const rows = data ?? [];

  return (
    <div className="space-y-5">
      <Card className="flex items-center gap-3 border-border/60 bg-card/70 p-5 backdrop-blur">
        <BellRing className="h-5 w-5 text-primary" />
        <div>
          <div className="font-display text-sm font-semibold">Alerts route to Telegram admin chat instantly.</div>
          <p className="text-xs text-muted-foreground">Thresholds: CPU 85%, disk 85%, cert expires ≤7 days, service down ≥3× in one hour.</p>
        </div>
      </Card>

      <div className="grid gap-3">
        {rows.map((a) => (
          <Card key={a.id} className={cn(
            "relative overflow-hidden border-border/60 bg-card/70 p-4 backdrop-blur",
            !a.acknowledged && "aurora-ring",
          )}>
            <div className={cn(
              "absolute inset-y-0 left-0 w-1",
              a.level === "critical" ? "bg-destructive" : a.level === "warn" ? "bg-warning" : "bg-primary",
            )} />
            <div className="flex items-start gap-3 pl-2">
              {a.level === "critical" ? <AlertTriangle className="h-4 w-4 text-destructive" /> :
               a.level === "warn"     ? <AlertTriangle className="h-4 w-4 text-warning" /> :
                                        <Info className="h-4 w-4 text-primary" />}
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn(
                    "mono uppercase",
                    a.level === "critical" ? "border-destructive/40 text-destructive" :
                    a.level === "warn"     ? "border-warning/40 text-warning" :
                                             "border-primary/40 text-primary",
                  )}>{a.level}</Badge>
                  <Badge variant="outline" className="mono uppercase">{a.source}</Badge>
                  <span className="mono text-xs text-muted-foreground">{new Date(a.ts).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-sm">{a.message}</div>
              </div>
              {a.acknowledged ? (
                <span className="mono flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> acked</span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => ack.mutate(a.id)}>Acknowledge</Button>
              )}
            </div>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card className="border-border/60 bg-card/70 p-10 text-center text-sm text-muted-foreground backdrop-blur">
            No alerts. System is healthy.
          </Card>
        )}
      </div>
    </div>
  );
}
