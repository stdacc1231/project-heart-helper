import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, formatBytes, type Account, type Protocol } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/accounts")({
  head: () => ({ meta: [{ title: "Accounts — Autoscript Panel" }] }),
  component: AccountsPage,
});

const PROTOCOLS: (Protocol | "all")[] = ["all", "ssh", "vmess", "vless", "trojan"];

function AccountsPage() {
  const [proto, setProto] = useState<Protocol | "all">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["accounts", proto],
    queryFn: () => api.accounts.list(proto === "all" ? undefined : proto),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.accounts.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Account deleted");
    },
  });

  const filtered = (data ?? []).filter((a) =>
    a.username.toLowerCase().includes(q.toLowerCase()) ||
    (a.telegramId ?? "").includes(q),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={proto} onValueChange={(v) => setProto(v as Protocol | "all")}>
          <TabsList>
            {PROTOCOLS.map((p) => (
              <TabsTrigger key={p} value={p} className="uppercase">{p}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search user or Telegram ID…" className="pl-8 w-64" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> New account
          </Button>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Protocol</TableHead>
              <TableHead>Telegram</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Limits</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead>Online</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">
                  <Link to="/accounts/$id" params={{ id: a.id }} className="hover:underline">{a.username}</Link>
                </TableCell>
                <TableCell><Badge variant="outline" className="uppercase">{a.protocol}</Badge></TableCell>
                <TableCell className="text-xs font-mono">{a.telegramId ?? "—"}</TableCell>
                <TableCell className="text-sm">{new Date(a.expiresAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-xs">
                  <div>IP: {a.ipLimit}</div>
                  <div>↓ {a.speedDnKbps ? `${a.speedDnKbps} kbps` : "∞"}</div>
                  <div>↑ {a.speedUpKbps ? `${a.speedUpKbps} kbps` : "∞"}</div>
                  <div>Quota: {a.quotaGb ? `${a.quotaGb} GB` : "∞"}</div>
                </TableCell>
                <TableCell className="text-sm">{formatBytes(a.usedBytes)}</TableCell>
                <TableCell>{a.online > 0 ? <Badge>{a.online}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <Badge variant={a.status === "active" ? "secondary" : "destructive"}>{a.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" asChild>
                    <Link to="/accounts/$id" params={{ id: a.id }}><Pencil className="h-4 w-4" /></Link>
                  </Button>
                  <Button variant="ghost" size="icon"
                    onClick={() => { if (confirm(`Delete ${a.username}?`)) remove.mutate(a.id); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">No accounts.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <CreateDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const { data: plans } = useQuery({ queryKey: ["plans"], queryFn: () => api.plans.list() });
  const [f, setF] = useState<Partial<Account>>({
    protocol: "ssh", username: "", password: "",
    ipLimit: 2, speedUpKbps: 0, speedDnKbps: 0, quotaGb: 0,
    expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
  });
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.accounts.create({ ...f, expiresAt: new Date(f.expiresAt!).toISOString() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Account created");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyPlan = (planId: string) => {
    const p = plans?.find((x) => x.id === planId);
    if (!p) return setF({ ...f, planId });
    setF({
      ...f, planId,
      ipLimit: p.ipLimit,
      speedUpKbps: p.speedUpKbps,
      speedDnKbps: p.speedDnKbps,
      quotaGb: p.quotaGb,
      expiresAt: new Date(Date.now() + (p.durationDays || 30) * 86400_000).toISOString().slice(0, 10),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New account</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Protocol</Label>
            <Select value={f.protocol} onValueChange={(v) => setF({ ...f, protocol: v as Protocol })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ssh">SSH / WebSocket</SelectItem>
                <SelectItem value="vmess">VMess</SelectItem>
                <SelectItem value="vless">VLESS</SelectItem>
                <SelectItem value="trojan">Trojan</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Plan (optional)</Label>
            <Select value={f.planId ?? ""} onValueChange={applyPlan}>
              <SelectTrigger><SelectValue placeholder="Custom" /></SelectTrigger>
              <SelectContent>
                {plans?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          </div>
          {f.protocol === "ssh" && (
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input value={f.password ?? ""} onChange={(e) => setF({ ...f, password: e.target.value })} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Telegram ID</Label>
            <Input placeholder="optional" value={f.telegramId ?? ""} onChange={(e) => setF({ ...f, telegramId: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Expires</Label>
            <Input type="date" value={f.expiresAt?.slice(0, 10)} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>IP limit</Label>
            <Input type="number" value={f.ipLimit} onChange={(e) => setF({ ...f, ipLimit: +e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Down (kbps, 0 = ∞)</Label>
            <Input type="number" value={f.speedDnKbps} onChange={(e) => setF({ ...f, speedDnKbps: +e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Up (kbps, 0 = ∞)</Label>
            <Input type="number" value={f.speedUpKbps} onChange={(e) => setF({ ...f, speedUpKbps: +e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Quota GB (0 = ∞)</Label>
            <Input type="number" value={f.quotaGb} onChange={(e) => setF({ ...f, quotaGb: +e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!f.username || create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
