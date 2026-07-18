import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, UsersRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, formatMoney, type Reseller } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/resellers")({
  head: () => ({ meta: [{ title: "Resellers — Autoscript" }] }),
  component: ResellersPage,
});

function ResellersPage() {
  const { data } = useQuery({ queryKey: ["resellers"], queryFn: () => api.resellers.list() });
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Partial<Reseller> | null>(null);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api.resellers.save(edit ?? {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["resellers"] }); toast.success("Saved"); setOpen(false); setEdit(null); },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Sub-admins with a wallet balance and user quota. They create their own users via bot or panel.</p>
        </div>
        <Button onClick={() => { setEdit({ name: "", quotaUsers: 20, balanceCents: 0, active: true }); setOpen(true); }}>
          <Plus className="mr-1 h-4 w-4" /> New reseller
        </Button>
      </div>

      <Card className="overflow-hidden border-border/60 bg-card/70 backdrop-blur">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reseller</TableHead>
              <TableHead>Telegram</TableHead>
              <TableHead>Balance</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Since</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium flex items-center gap-2"><UsersRound className="h-4 w-4 text-accent" />{r.name}</TableCell>
                <TableCell className="mono text-xs">{r.telegramId ?? "—"}</TableCell>
                <TableCell className="mono tabular-nums">{formatMoney(r.balanceCents)}</TableCell>
                <TableCell className="mono text-xs">{r.usersCreated} / {r.quotaUsers}</TableCell>
                <TableCell><Badge variant="outline" className={r.active ? "border-primary/40 text-primary" : "border-destructive/40 text-destructive"}>{r.active ? "active" : "disabled"}</Badge></TableCell>
                <TableCell className="mono text-xs">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => { setEdit(r); setOpen(true); }}>Edit</Button>
                </TableCell>
              </TableRow>
            ))}
            {(!data || data.length === 0) && (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No resellers.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEdit(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? "Edit reseller" : "New reseller"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5"><Label>Name</Label><Input value={edit?.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Telegram ID</Label><Input value={edit?.telegramId ?? ""} onChange={(e) => setEdit({ ...edit, telegramId: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Balance ($)</Label><Input type="number" step="0.01" value={(edit?.balanceCents ?? 0) / 100} onChange={(e) => setEdit({ ...edit, balanceCents: Math.round(+e.target.value * 100) })} /></div>
              <div className="space-y-1.5"><Label>User quota</Label><Input type="number" value={edit?.quotaUsers ?? 0} onChange={(e) => setEdit({ ...edit, quotaUsers: +e.target.value })} /></div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 p-3">
              <div><div className="text-sm">Active</div><div className="text-xs text-muted-foreground">Disabled resellers can't create users.</div></div>
              <Switch checked={edit?.active ?? true} onCheckedChange={(v) => setEdit({ ...edit, active: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={!edit?.name}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
