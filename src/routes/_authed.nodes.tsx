import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Server, Wifi } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/nodes")({
  head: () => ({ meta: [{ title: "Nodes — Autoscript" }] }),
  component: NodesPage,
});

function NodesPage() {
  const { data } = useQuery({ queryKey: ["nodes"], queryFn: () => api.nodes.list(), refetchInterval: 8000 });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ label: "", host: "", region: "" });
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: () => api.nodes.add(f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["nodes"] }); toast.success("Node added"); setOpen(false); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.nodes.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["nodes"] }); toast.success("Node removed"); },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Multi-server: this panel orchestrates every node over the internal WireGuard mesh.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> Add node</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((n) => (
          <Card key={n.id} className="relative overflow-hidden border-border/60 bg-card/70 p-5 backdrop-blur transition hover:aurora-ring">
            <div className={`absolute inset-x-0 top-0 h-0.5 ${n.status === "online" ? "bg-primary" : n.status === "degraded" ? "bg-warning" : "bg-destructive"}`} />
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-primary" />
                  <div className="font-display text-lg font-semibold">{n.label}</div>
                </div>
                <div className="mono mt-1 text-xs text-muted-foreground">{n.host}</div>
              </div>
              <Badge
                variant="outline"
                className={
                  n.status === "online" ? "border-primary/40 text-primary" :
                  n.status === "degraded" ? "border-warning/40 text-warning" : "border-destructive/40 text-destructive"
                }
              >
                <Wifi className="mr-1 h-3 w-3" /> {n.status}
              </Badge>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
              <Metric label="CPU"    value={`${n.cpu}%`} />
              <Metric label="Memory" value={`${n.memory}%`} />
              <Metric label="Users"  value={String(n.users)} />
              <Metric label="Region" value={n.region} />
              <Metric label="Bw"     value={`${n.bandwidthMbps} Mbps`} />
              <Metric label="Ver"    value={n.version} />
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10"
                onClick={() => { if (confirm(`Remove ${n.label}?`)) remove.mutate(n.id); }}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add node</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5"><Label>Label</Label><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Frankfurt-2" /></div>
            <div className="space-y-1.5"><Label>Host</Label><Input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="de2.example.com" /></div>
            <div className="space-y-1.5"><Label>Region</Label><Input value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} placeholder="EU" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => add.mutate()} disabled={!f.label || !f.host}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-2">
      <div className="mono text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mono font-medium tabular-nums">{value}</div>
    </div>
  );
}
