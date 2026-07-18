import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, Plus, ArrowDown, ArrowUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, formatMoney } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/wallet")({
  head: () => ({ meta: [{ title: "Wallet — Autoscript" }] }),
  component: WalletPage,
});

function WalletPage() {
  const { data: txs } = useQuery({ queryKey: ["wallet"], queryFn: () => api.wallet.list() });
  const { data: bal } = useQuery({ queryKey: ["wallet-balance"], queryFn: () => api.wallet.balance() });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: 5, reason: "Manual top-up" });
  const qc = useQueryClient();
  const credit = useMutation({
    mutationFn: () => api.wallet.credit(Math.round(f.amount * 100), f.reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["wallet-balance"] });
      toast.success("Wallet updated"); setOpen(false);
    },
  });

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden border-border/60 bg-card/70 p-6 backdrop-blur">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -left-10 -bottom-16 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-2">
              <Wallet className="h-3.5 w-3.5" /> House wallet balance
            </div>
            <div className="mt-2 font-display text-5xl font-semibold tabular-nums aurora-text">
              {formatMoney(bal?.balanceCents ?? 0)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">PAYG deductions and top-ups.</p>
          </div>
          <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> Top up / adjust</Button>
        </div>
      </Card>

      <Card className="overflow-hidden border-border/60 bg-card/70 backdrop-blur">
        <div className="border-b border-border/60 px-4 py-3">
          <div className="font-display text-sm font-semibold">Transactions</div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>User</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Balance after</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(txs ?? []).map((t) => (
              <TableRow key={t.id}>
                <TableCell className="mono text-xs">{new Date(t.ts).toLocaleString()}</TableCell>
                <TableCell>{t.reason}</TableCell>
                <TableCell className="mono text-xs">{t.telegramId ?? "—"}</TableCell>
                <TableCell className={`mono text-right tabular-nums ${t.amountCents >= 0 ? "text-primary" : "text-destructive"}`}>
                  {t.amountCents >= 0 ? <ArrowUp className="mr-1 inline h-3.5 w-3.5" /> : <ArrowDown className="mr-1 inline h-3.5 w-3.5" />}
                  {formatMoney(Math.abs(t.amountCents))}
                </TableCell>
                <TableCell className="mono text-right tabular-nums">{formatMoney(t.balanceAfterCents)}</TableCell>
              </TableRow>
            ))}
            {(!txs || txs.length === 0) && (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No transactions.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adjust wallet</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5"><Label>Amount ($ — negative to debit)</Label><Input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: +e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Reason</Label><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => credit.mutate()}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
