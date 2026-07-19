import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Cloud, Plus, Save, Trash2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { api, type Cdn } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/cdns")({
  head: () => ({ meta: [{ title: "CDN endpoints — GRVPN Panel" }] }),
  component: CdnsPage,
});

// CDN endpoints are Xray-only (SSH uses its own domain). We hardcode protocols=["xray"].
const EMPTY: Partial<Cdn> = { name: "", url: "", protocols: ["xray"], accountIds: [] };

function CdnsPage() {
  const qc = useQueryClient();
  const { data: cdns = [] } = useQuery({ queryKey: ["cdns"], queryFn: () => api.cdns.list() });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts.list() });
  const [edit, setEdit] = useState<Partial<Cdn> | null>(null);

  const save = useMutation({
    mutationFn: (c: Partial<Cdn>) => api.cdns.save(c),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cdns"] }); toast.success("Saved"); setEdit(null); },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.cdns.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cdns"] }); toast.success("Deleted"); },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Cloud className="h-5 w-5" /> CDN endpoints</h2>
          <p className="text-sm text-muted-foreground">
            Add CDN hostnames your users can drop into their client config. Pick which protocols and accounts see each one.
          </p>
        </div>
        <Button onClick={() => setEdit({ ...EMPTY })}><Plus className="mr-1 h-4 w-4" /> Add CDN</Button>
      </div>

      {edit && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">{edit.id ? "Edit CDN" : "New CDN"}</h3>
            <Button variant="ghost" size="icon" onClick={() => setEdit(null)}><X className="h-4 w-4" /></Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Cloudflare, Bunny, GCore…" />
            </div>
            <div className="space-y-1.5">
              <Label>URL / host</Label>
              <Input value={edit.url ?? ""} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="cdn.example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Protocol</Label>
              <div className="flex items-center gap-2 pt-1">
                <Badge variant="outline" className="uppercase">Xray</Badge>
                <span className="text-xs text-muted-foreground">CDN endpoints are Xray-only.</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Accounts (empty = every Xray account)</Label>
              <div className="max-h-40 overflow-y-auto rounded-md border p-2 text-sm">
                {accounts.filter((a) => a.protocol !== "ssh").length === 0 ? (
                  <div className="text-muted-foreground">No Xray accounts.</div>
                ) : accounts.filter((a) => a.protocol !== "ssh").map((a) => {
                  const on = (edit.accountIds ?? []).includes(a.id);
                  return (
                    <label key={a.id} className="flex cursor-pointer items-center gap-2 py-0.5">
                      <Checkbox checked={on} onCheckedChange={(v) => {
                        const set = new Set(edit.accountIds ?? []);
                        if (v) set.add(a.id); else set.delete(a.id);
                        setEdit({ ...edit, accountIds: Array.from(set) });
                      }} />
                      <span className="mono uppercase text-[10px] text-muted-foreground">{a.protocol}</span>
                      <span>{a.username}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => save.mutate(edit)} disabled={!edit.name?.trim() || !edit.url?.trim()}>
              <Save className="mr-1 h-4 w-4" /> Save
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-4">
        {cdns.length === 0 ? (
          <div className="text-sm text-muted-foreground">No CDN endpoints yet. Add one to surface it on user status pages and Telegram messages.</div>
        ) : (
          <div className="space-y-2">
            {cdns.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="font-mono text-xs text-muted-foreground break-all">{c.url}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {c.protocols.length ? c.protocols.map((p) => <Badge key={p} variant="outline" className="uppercase">{p}</Badge>) : <Badge variant="outline">All protocols</Badge>}
                    <Badge variant="secondary">{c.accountIds.length ? `${c.accountIds.length} account${c.accountIds.length > 1 ? "s" : ""}` : "All accounts"}</Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEdit(c)}>Edit</Button>
                  <Button variant="destructive" size="sm" onClick={() => confirm("Delete CDN?") && remove.mutate(c.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
