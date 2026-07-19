import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Mail, Send, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, formatMoney } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/invoices")({
  head: () => ({ meta: [{ title: "Invoices — GRVPN" }] }),
  component: InvoicesPage,
});

function InvoicesPage() {
  const { data } = useQuery({ queryKey: ["invoices"], queryFn: () => api.invoices.list() });
  const send = useMutation({
    mutationFn: ({ id, via }: { id: string; via: "email" | "telegram" }) => api.invoices.send(id, via),
    onSuccess: (_r, v) => toast.success(`Invoice sent via ${v.via}`),
  });

  return (
    <div className="space-y-5">
      <Card className="border-border/60 bg-card/70 p-5 backdrop-blur">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <div className="font-display text-sm font-semibold">Invoices are generated automatically on every approved payment.</div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">PDFs are stored on the VPS and can be re-sent to Telegram or email at any time.</p>
      </Card>

      <Card className="overflow-hidden border-border/60 bg-card/70 backdrop-blur">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="mono">{inv.number}</TableCell>
                <TableCell className="mono text-xs">{new Date(inv.issuedAt).toLocaleDateString()}</TableCell>
                <TableCell>{inv.username} <span className="mono ml-1 text-xs text-muted-foreground">{inv.telegramId ?? ""}</span></TableCell>
                <TableCell>{inv.planName}</TableCell>
                <TableCell><Badge variant="outline" className="uppercase mono text-[10px]">{inv.method}</Badge></TableCell>
                <TableCell className="mono text-right tabular-nums">{formatMoney(inv.amountCents)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" asChild title="Download PDF">
                    <a href={inv.pdfUrl}><Download className="h-4 w-4" /></a>
                  </Button>
                  <Button variant="ghost" size="icon" title="Email" onClick={() => send.mutate({ id: inv.id, via: "email" })}><Mail className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" title="Telegram" onClick={() => send.mutate({ id: inv.id, via: "telegram" })}><Send className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {(!data || data.length === 0) && (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">No invoices yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
