import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { ArrowLeft, Copy, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { api, formatBytes, type Account } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/accounts/$id")({
  head: () => ({ meta: [{ title: "Account — Autoscript Panel" }] }),
  component: AccountDetail,
});

function AccountDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["account", id], queryFn: () => api.accounts.get(id) });
  const { data: cfg } = useQuery({ queryKey: ["account-cfg", id], queryFn: () => api.accounts.config(id) });
  const [f, setF] = useState<Partial<Account>>({});
  useEffect(() => { if (data) setF(data); }, [data]);

  const save = useMutation({
    mutationFn: () => api.accounts.update(id, f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Saved");
    },
  });
  const remove = useMutation({
    mutationFn: () => api.accounts.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Deleted");
      navigate({ to: "/accounts" });
    },
  });

  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild><Link to="/accounts"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <h2 className="text-lg font-semibold">{data.username}</h2>
        <Badge variant="outline" className="uppercase">{data.protocol}</Badge>
        <Badge>{data.status}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium">Details</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Expires</Label>
              <Input type="date" value={f.expiresAt?.slice(0, 10) ?? ""} onChange={(e) => setF({ ...f, expiresAt: new Date(e.target.value).toISOString() })} />
            </div>
            <div className="space-y-1.5">
              <Label>IP limit</Label>
              <Input type="number" value={f.ipLimit ?? 0} onChange={(e) => setF({ ...f, ipLimit: +e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Speed (kbps)</Label>
              <Input type="number" value={f.speedLimitKbps ?? 0} onChange={(e) => setF({ ...f, speedLimitKbps: +e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Quota (GB)</Label>
              <Input type="number" value={f.quotaGb ?? 0} onChange={(e) => setF({ ...f, quotaGb: +e.target.value })} />
            </div>
            {data.protocol === "ssh" && (
              <div className="col-span-2 space-y-1.5">
                <Label>Password</Label>
                <Input value={f.password ?? ""} onChange={(e) => setF({ ...f, password: e.target.value })} />
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-between">
            <Button variant="destructive" onClick={() => confirm("Delete?") && remove.mutate()}>
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
            <Button onClick={() => save.mutate()}>
              <Save className="mr-1 h-4 w-4" /> Save changes
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-sm font-medium">Usage</h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Used" value={formatBytes(data.usedBytes)} />
            <Field label="Online now" value={String(data.online)} />
            <Field label="Created" value={new Date(data.createdAt).toLocaleString()} />
            <Field label="Expires" value={new Date(data.expiresAt).toLocaleString()} />
            {data.uuid && <Field label="UUID" value={data.uuid} mono />}
          </dl>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Client config</h3>
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(cfg?.link ?? ""); toast.success("Copied"); }}>
              <Copy className="mr-1 h-4 w-4" /> Copy link
            </Button>
          </div>
          <Input readOnly value={cfg?.link ?? ""} className="font-mono text-xs" />
          {cfg?.text && (
            <Textarea readOnly value={cfg.text} className="mt-3 font-mono text-xs" rows={6} />
          )}
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs break-all" : ""}>{value}</dd>
    </div>
  );
}
