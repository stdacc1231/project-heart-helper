import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, formatMoney, type Plan, type PlanMode } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/plans")({
  head: () => ({ meta: [{ title: "Plans — GRVPN Panel" }] }),
  component: PlansPage,
});

const MODE_LABEL: Record<PlanMode, string> = {
  prepaid: "Prepaid (fixed price + duration)",
  payg_gb: "Pay-as-you-go (per GB)",
  payg_day: "Pay-as-you-go (per day)",
};

function PlansPage() {
  const { data } = useQuery({ queryKey: ["plans"], queryFn: () => api.plans.list() });
  const [editing, setEditing] = useState<Plan | null>(null);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api.plans.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["plans"] }); toast.success("Plan deleted"); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Plans</h2>
          <p className="text-sm text-muted-foreground">Configure prepaid and pay-as-you-go plans shown to Telegram users.</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> New plan
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Quota</TableHead>
              <TableHead>Speed (↓/↑)</TableHead>
              <TableHead>IPs</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell><Badge variant="outline">{MODE_LABEL[p.mode]}</Badge></TableCell>
                <TableCell>{formatMoney(p.priceCents)}{p.mode !== "prepaid" && <span className="text-xs text-muted-foreground"> /{p.mode === "payg_gb" ? "GB" : "day"}</span>}</TableCell>
                <TableCell>{p.durationDays ? `${p.durationDays}d` : "—"}</TableCell>
                <TableCell>{p.quotaGb ? `${p.quotaGb} GB` : "∞"}</TableCell>
                <TableCell className="text-xs">{p.speedDnKbps ? `${(p.speedDnKbps/1000).toFixed(p.speedDnKbps%1000?1:0)}` : "∞"} / {p.speedUpKbps ? `${(p.speedUpKbps/1000).toFixed(p.speedUpKbps%1000?1:0)}` : "∞"} Mbps</TableCell>
                <TableCell>{p.ipLimit}</TableCell>
                <TableCell><Badge variant={p.active ? "secondary" : "outline"}>{p.active ? "yes" : "no"}</Badge></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => { setEditing(p); setOpen(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => confirm(`Delete ${p.name}?`) && remove.mutate(p.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(data ?? []).length === 0 && (
              <TableRow><TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">No plans yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <PlanDialog open={open} onOpenChange={setOpen} initial={editing} />
    </div>
  );
}

function PlanDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (b: boolean) => void; initial: Plan | null }) {
  const [f, setF] = useState<Partial<Plan>>(initial ?? {
    name: "", mode: "prepaid", priceCents: 500, durationDays: 30,
    quotaGb: 0, speedUpKbps: 0, speedDnKbps: 0, ipLimit: 2, active: true,
  });
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api.plans.save({ ...initial, ...f }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast.success(initial ? "Plan updated" : "Plan created");
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initial ? "Edit plan" : "New plan"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Name</Label>
            <Input value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Mode</Label>
            <Select value={f.mode} onValueChange={(v) => setF({ ...f, mode: v as PlanMode })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="prepaid">Prepaid</SelectItem>
                <SelectItem value="payg_gb">PAYG per-GB</SelectItem>
                <SelectItem value="payg_day">PAYG per-day</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Price (¢)</Label>
            <Input type="number" value={f.priceCents ?? 0} onChange={(e) => setF({ ...f, priceCents: +e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Duration (days)</Label>
            <Input type="number" value={f.durationDays ?? 0} onChange={(e) => setF({ ...f, durationDays: +e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Quota GB (0 = ∞)</Label>
            <Input type="number" value={f.quotaGb ?? 0} onChange={(e) => setF({ ...f, quotaGb: +e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>IP limit</Label>
            <Input type="number" value={f.ipLimit ?? 2} onChange={(e) => setF({ ...f, ipLimit: +e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Down (Mbps)</Label>
            <Input type="number" step="0.1" min="0" value={(f.speedDnKbps ?? 0)/1000} onChange={(e) => setF({ ...f, speedDnKbps: Math.round((+e.target.value) * 1000) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Up (Mbps)</Label>
            <Input type="number" step="0.1" min="0" value={(f.speedUpKbps ?? 0)/1000} onChange={(e) => setF({ ...f, speedUpKbps: Math.round((+e.target.value) * 1000) })} />
          </div>
          <div className="col-span-2 flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Shown in Telegram bot plan list.</p>
            </div>
            <Switch checked={f.active ?? true} onCheckedChange={(v) => setF({ ...f, active: v })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!f.name || save.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
