import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, formatMoney, type Payment } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/payments")({
  head: () => ({ meta: [{ title: "Payments — Autoscript Panel" }] }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const [status, setStatus] = useState<Payment["status"] | "all">("pending");
  const { data } = useQuery({
    queryKey: ["payments", status],
    queryFn: () => api.payments.list(status === "all" ? undefined : status),
  });
  const qc = useQueryClient();
  const approve = useMutation({
    mutationFn: (id: string) => api.payments.decide(id, "approved"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payments"] }); toast.success("Approved — account provisioned"); },
  });
  const reject = useMutation({
    mutationFn: (id: string) => api.payments.decide(id, "rejected"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payments"] }); toast.success("Rejected"); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Payment approvals</h2>
          <p className="text-sm text-muted-foreground">Approving auto-creates the account and sends config back through the bot.</p>
        </div>
        <Tabs value={status} onValueChange={(v) => setStatus(v as any)}>
          <TabsList>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="rejected">Rejected</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((p) => (
          <Card key={p.id} className="overflow-hidden">
            <img src={p.proofUrl} alt="payment proof" className="h-48 w-full object-cover" />
            <div className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-medium">{p.telegramName}</div>
                <Badge variant={p.status === "pending" ? "outline" : p.status === "approved" ? "secondary" : "destructive"}>{p.status}</Badge>
              </div>
              <div className="text-xs text-muted-foreground font-mono">{p.telegramId}</div>
              <div className="flex items-center justify-between text-sm">
                <span>{p.planName}</span>
                <span className="font-semibold">{formatMoney(p.amountCents)}</span>
              </div>
              <div className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</div>
              {p.status === "pending" && (
                <div className="flex gap-2 pt-2">
                  <Button size="sm" className="flex-1" onClick={() => approve.mutate(p.id)}>
                    <Check className="mr-1 h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => reject.mutate(p.id)}>
                    <X className="mr-1 h-4 w-4" /> Reject
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ))}
        {(data ?? []).length === 0 && (
          <div className="col-span-full py-16 text-center text-sm text-muted-foreground">No payments in this bucket.</div>
        )}
      </div>
    </div>
  );
}
