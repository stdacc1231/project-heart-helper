import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Trash2, Pencil, Search, Copy, Send, Zap, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, formatBytes, PROTOCOL_LABELS, type Account, type Protocol } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/accounts")({
  head: () => ({ meta: [{ title: "Accounts — GRVPN Panel" }] }),
  component: AccountsPage,
});

const PROTOCOLS: (Protocol | "all")[] = ["all", "ssh", "vmess", "vless", "trojan"];

function AccountsPage() {
  const [proto, setProto] = useState<Protocol | "all">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["accounts", proto],
    queryFn: () => api.accounts.list(proto === "all" ? undefined : proto),
    refetchInterval: 15000,
  });


  const remove = useMutation({
    mutationFn: (id: string) => api.accounts.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); toast.success("Account deleted"); },
  });
  const bulk = useMutation({
    mutationFn: ({ action, days }: { action: "extend" | "delete" | "lock" | "unlock"; days?: number }) =>
      api.accounts.bulk(action, Object.keys(selected).filter((k) => selected[k]), days),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounts"] }); setSelected({}); toast.success("Bulk action applied"); },
  });

  const filtered = useMemo(() => (data ?? []).filter((a) =>
    a.username.toLowerCase().includes(q.toLowerCase()) ||
    (a.telegramId ?? "").includes(q),
  ), [data, q]);

  const selCount = Object.values(selected).filter(Boolean).length;

  async function copySub(id: string) {
    const { url } = await api.accounts.subscriptionUrl(id);
    await navigator.clipboard.writeText(url);
    toast.success("Subscription URL copied");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={proto} onValueChange={(v) => setProto(v as Protocol | "all")}>
          <TabsList className="mono uppercase">
            {PROTOCOLS.map((p) => (
              <TabsTrigger key={p} value={p} className="text-[11px] tracking-widest">{p}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search user or Telegram ID…" className="pl-8 w-64" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={() => setTrialOpen(true)}><Clock className="mr-1 h-3.5 w-3.5" /> Trial user</Button>
          <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> New account</Button>
        </div>
      </div>

      {selCount > 0 && (
        <Card className="flex flex-wrap items-center gap-2 border-primary/40 bg-primary/5 p-3">
          <div className="mono text-xs uppercase tracking-widest text-primary">{selCount} selected</div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => bulk.mutate({ action: "extend", days: 30 })}>Extend 30d</Button>
            <Button size="sm" variant="outline" onClick={() => bulk.mutate({ action: "lock" })}>Lock</Button>
            <Button size="sm" variant="outline" onClick={() => bulk.mutate({ action: "unlock" })}>Unlock</Button>
            <Button size="sm" variant="destructive" onClick={() => { if (confirm(`Delete ${selCount} accounts?`)) bulk.mutate({ action: "delete" }); }}>Delete</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden border-border/60 bg-card/70 backdrop-blur">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={filtered.length > 0 && filtered.every((a) => selected[a.id])}
                  onCheckedChange={(v) => {
                    const next: Record<string, boolean> = {};
                    if (v) filtered.forEach((a) => (next[a.id] = true));
                    setSelected(next);
                  }}
                />
              </TableHead>
              <TableHead>User</TableHead>
              <TableHead>Protocol</TableHead>
              <TableHead>Telegram</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Limits</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead>Online</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((a) => (
              <TableRow
                key={a.id}
                className={`${selected[a.id] ? "bg-primary/5" : ""} cursor-pointer hover:bg-muted/30`}
                onClick={() => navigate({ to: "/accounts/$id", params: { id: a.id } })}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={!!selected[a.id]} onCheckedChange={(v) => setSelected((s) => ({ ...s, [a.id]: !!v }))} />
                </TableCell>
                <TableCell className="font-medium">
                  <Link to="/accounts/$id" params={{ id: a.id }} className="hover:underline">{a.username}</Link>
                </TableCell>
                <TableCell><Badge variant="outline" className="mono uppercase">{PROTOCOL_LABELS[a.protocol]}</Badge></TableCell>
                <TableCell className="mono text-xs">{a.telegramId ?? "—"}</TableCell>
                <TableCell className="mono text-xs">{new Date(a.expiresAt).toLocaleDateString()}</TableCell>
                <TableCell className="mono text-[11px] leading-tight">
                  <div>IP {a.ipLimit}</div>
                  <div>↓ {a.speedDnKbps ? `${(a.speedDnKbps/1000).toFixed(a.speedDnKbps%1000?1:0)}M` : "∞"}  ↑ {a.speedUpKbps ? `${(a.speedUpKbps/1000).toFixed(a.speedUpKbps%1000?1:0)}M` : "∞"}</div>
                  <div>Q {a.quotaGb ? `${a.quotaGb}G` : "∞"}</div>
                </TableCell>
                <TableCell className="mono text-xs">{formatBytes(a.usedBytes)}</TableCell>
                <TableCell>{a.online > 0 ? <Badge className="bg-primary/20 text-primary hover:bg-primary/30">{a.online}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="space-x-1">
                  <Badge
                    variant="outline"
                    title={
                      a.status === "pending"
                        ? (a.warning
                            ? `Pending — provisioning warning: ${a.warning}. Account saved but system user/config may need attention.`
                            : "Pending — awaiting admin approval or provisioning finish.")
                        : a.status
                    }
                    className={
                      a.status === "active" ? "border-primary/40 text-primary" :
                      a.status === "trial"  ? "border-accent/40 text-accent" :
                      a.status === "pending" ? "border-warning/40 text-warning cursor-help" :
                      a.status === "locked" ? "border-warning/40 text-warning" :
                      a.status === "suspended" ? "border-destructive/40 text-destructive" :
                      "border-destructive/40 text-destructive"
                    }
                  >{a.status}{a.status === "pending" ? " ⓘ" : ""}</Badge>

                </TableCell>

                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" title="Copy subscription URL" onClick={() => copySub(a.id)}><Copy className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" title="Send via Telegram" onClick={() => api.accounts.sendTelegram(a.id).then(() => toast.success("Sent"))}><Send className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" title="Open / edit" asChild>
                    <Link to="/accounts/$id" params={{ id: a.id }}><Pencil className="h-4 w-4" /></Link>
                  </Button>

                  <Button variant="ghost" size="icon" title="Delete"
                    onClick={() => { if (confirm(`Delete ${a.username}?`)) remove.mutate(a.id); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={10} className="py-12 text-center text-sm text-muted-foreground">No accounts.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <CreateDialog open={open} onOpenChange={setOpen} />
      <TrialDialog open={trialOpen} onOpenChange={setTrialOpen} />
      <EditDialog id={editId} onOpenChange={(b) => !b && setEditId(null)} />
    </div>
  );
}


function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const { data: plans } = useQuery({ queryKey: ["plans"], queryFn: () => api.plans.list() });
  const [trialHours, setTrialHours] = useState<number>(0);
  const [f, setF] = useState<Partial<Account>>({
    protocol: "ssh", username: "", password: "",
    ipLimit: 2, speedUpKbps: 0, speedDnKbps: 0, quotaGb: 0,
    expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
    trial: false,
  });
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => {
      const expiresAt = trialHours > 0
        ? new Date(Date.now() + trialHours * 3600_000).toISOString()
        : new Date(f.expiresAt!).toISOString();
      return api.accounts.create({ ...f, trial: trialHours > 0 || !!f.trial, expiresAt });
    },
    onSuccess: (acc) => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      if (acc?.warning) {
        toast.warning(`Account saved as pending: ${acc.warning}`);
      } else {
        toast.success("Account created");
      }
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
      speedUpKbps: p.speedUpKbps, speedDnKbps: p.speedDnKbps,
      quotaGb: p.quotaGb,
      expiresAt: new Date(Date.now() + (p.durationDays || 30) * 86400_000).toISOString().slice(0, 10),
    });
    setTrialHours(0);
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> New account</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Protocol</Label>
            <Select value={f.protocol} onValueChange={(v) => setF({ ...f, protocol: v as Protocol })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["ssh", "vmess", "vless", "trojan"] as Protocol[]).map((p) => (
                  <SelectItem key={p} value={p}>{PROTOCOL_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Plan (optional)</Label>
            <Select value={f.planId ?? ""} onValueChange={applyPlan}>
              <SelectTrigger><SelectValue placeholder="Custom" /></SelectTrigger>
              <SelectContent>{plans?.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
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
            <Label>IP limit (0 = ∞)</Label>
            <Input type="number" value={f.ipLimit} onChange={(e) => setF({ ...f, ipLimit: +e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Down (Mbps, 0 = ∞)</Label>
            <Input type="number" step="0.1" min="0" value={(f.speedDnKbps ?? 0)/1000} onChange={(e) => setF({ ...f, speedDnKbps: Math.round((+e.target.value) * 1000) })} />
          </div>

          <div className="space-y-1.5">
            <Label>Up (Mbps, 0 = ∞)</Label>
            <Input type="number" step="0.1" min="0" value={(f.speedUpKbps ?? 0)/1000} onChange={(e) => setF({ ...f, speedUpKbps: Math.round((+e.target.value) * 1000) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Quota GB (0 = ∞)</Label>
            <Input type="number" value={f.quotaGb} onChange={(e) => setF({ ...f, quotaGb: +e.target.value })} />
          </div>
          <div className="col-span-2">
            <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 p-3">
              <div className="min-w-0">
                <div className="text-sm">Trial (hours)</div>
                <div className="text-xs text-muted-foreground">Overrides expiry. 0 = disabled.</div>
              </div>
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={0} step={1}
                  className="w-20 text-right"
                  value={trialHours}
                  onChange={(e) => setTrialHours(Math.max(0, +e.target.value || 0))}
                />
                <Button type="button" size="sm" variant="outline" onClick={() => setTrialHours(1)}>1h</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setTrialHours(24)}>24h</Button>
              </div>
            </div>
          </div>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!f.username || create.isPending}>
            {create.isPending ? "Creating…" : "Create account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrialDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (b: boolean) => void }) {
  const [hours, setHours] = useState<number>(1);
  const [protocol, setProtocol] = useState<Protocol>("ssh");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [ipLimit, setIpLimit] = useState(1);
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.accounts.create({
      protocol, username, password, telegramId: telegramId || undefined,
      ipLimit, speedUpKbps: 0, speedDnKbps: 0, quotaGb: 0,
      trial: true,
      expiresAt: new Date(Date.now() + Math.max(1, hours) * 3600_000).toISOString(),
    }),
    onSuccess: (acc) => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      if (acc?.warning) toast.warning(`Trial saved as pending: ${acc.warning}`);
      else toast.success(`Trial account created (${hours}h)`);
      onOpenChange(false);
      setUsername(""); setPassword(""); setTelegramId("");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Clock className="h-4 w-4 text-accent" /> New trial user</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Protocol</Label>
            <Select value={protocol} onValueChange={(v) => setProtocol(v as Protocol)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["ssh", "vmess", "vless", "trojan"] as Protocol[]).map((p) => (
                  <SelectItem key={p} value={p}>{PROTOCOL_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Duration (hours)</Label>
            <div className="flex items-center gap-1">
              <Input type="number" min={1} value={hours} onChange={(e) => setHours(Math.max(1, +e.target.value || 1))} />
              <Button type="button" size="sm" variant="outline" onClick={() => setHours(1)}>1h</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setHours(3)}>3h</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setHours(24)}>24h</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          {protocol === "ssh" && (
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Telegram ID</Label>
            <Input placeholder="optional" value={telegramId} onChange={(e) => setTelegramId(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>IP limit</Label>
            <Input type="number" min={1} value={ipLimit} onChange={(e) => setIpLimit(+e.target.value || 1)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!username || create.isPending}>
            {create.isPending ? "Creating…" : `Create trial (${hours}h)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (b: boolean) => void }) {
  const qc = useQueryClient();
  const { data: detail } = useQuery({
    queryKey: ["account-detail", id],
    queryFn: () => api.accounts.detail(id!),
    enabled: !!id,
  });
  const [f, setF] = useState<Partial<Account>>({});
  const acc = detail?.account;
  // sync when a new account is loaded
  useMemo(() => { if (acc) setF(acc); }, [acc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => api.accounts.update(id!, f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["account-detail", id] });
      toast.success("Saved");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!id} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" /> Edit account {acc ? <Badge variant="outline" className="mono uppercase">{acc.protocol}</Badge> : null}
          </DialogTitle>
        </DialogHeader>
        {!acc ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input value={f.username ?? ""} disabled />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v as Account["status"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["active", "locked", "trial", "expired", "pending", "suspended"] as Account["status"][]).map((s) =>
                      <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>

              </div>
              {acc.protocol === "ssh" && (
                <div className="col-span-2 space-y-1.5">
                  <Label>Password</Label>
                  <Input value={f.password ?? ""} onChange={(e) => setF({ ...f, password: e.target.value })} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Telegram ID</Label>
                <Input value={f.telegramId ?? ""} onChange={(e) => setF({ ...f, telegramId: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Expires</Label>
                <Input type="date" value={f.expiresAt?.slice(0, 10) ?? ""} onChange={(e) => setF({ ...f, expiresAt: new Date(e.target.value).toISOString() })} />
              </div>
              <div className="space-y-1.5">
                <Label>IP limit (0 = ∞)</Label>
                <Input type="number" value={f.ipLimit ?? 0} onChange={(e) => setF({ ...f, ipLimit: +e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Quota GB (0 = ∞)</Label>
                <Input type="number" value={f.quotaGb ?? 0} onChange={(e) => setF({ ...f, quotaGb: +e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Down (Mbps, 0 = ∞)</Label>
                <Input type="number" step="0.1" min="0" value={(f.speedDnKbps ?? 0)/1000}
                  onChange={(e) => setF({ ...f, speedDnKbps: Math.round((+e.target.value) * 1000) })} />
              </div>
              <div className="space-y-1.5">
                <Label>Up (Mbps, 0 = ∞)</Label>
                <Input type="number" step="0.1" min="0" value={(f.speedUpKbps ?? 0)/1000}
                  onChange={(e) => setF({ ...f, speedUpKbps: Math.round((+e.target.value) * 1000) })} />
              </div>
            </div>
            <DialogFooter className="mt-2">
              <Button variant="outline" asChild>
                <Link to="/accounts/$id" params={{ id: acc.id }}>Open full page</Link>
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

