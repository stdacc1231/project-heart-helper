import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, HardDrive, RotateCcw, Trash2, Cloud, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, formatBytes } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/backups")({
  head: () => ({ meta: [{ title: "Backups — Autoscript" }] }),
  component: BackupsPage,
});

function BackupsPage() {
  const { data } = useQuery({ queryKey: ["backups"], queryFn: () => api.backups.list() });
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (dest: "local" | "telegram" | "s3") => api.backups.create(dest),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["backups"] }); toast.success("Backup created"); },
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.backups.restore(id),
    onSuccess: () => toast.success("Restore complete"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.backups.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["backups"] }); toast.success("Deleted"); },
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-border/60 bg-card/70 p-5 backdrop-blur">
          <div className="mono text-[10px] uppercase tracking-widest text-muted-foreground">Schedule</div>
          <div className="mt-1 font-display text-xl font-semibold">Daily at 03:00</div>
          <p className="mt-1 text-xs text-muted-foreground">Auto-backups keep the last 14 days.</p>
        </Card>
        <Card className="flex items-center justify-between border-border/60 bg-card/70 p-5 backdrop-blur">
          <div>
            <div className="mono text-[10px] uppercase tracking-widest text-muted-foreground">Create now</div>
            <div className="mt-1 text-sm">Snapshot DB + xray + nginx configs</div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Button size="sm" variant="outline" onClick={() => create.mutate("local")}><HardDrive className="mr-1 h-3.5 w-3.5" /> Local</Button>
            <Button size="sm" variant="outline" onClick={() => create.mutate("telegram")}><Send className="mr-1 h-3.5 w-3.5" /> Telegram</Button>
            <Button size="sm" variant="outline" onClick={() => create.mutate("s3")}><Cloud className="mr-1 h-3.5 w-3.5" /> S3</Button>
          </div>
        </Card>
        <Card className="border-border/60 bg-card/70 p-5 backdrop-blur">
          <div className="mono text-[10px] uppercase tracking-widest text-muted-foreground">Total backups</div>
          <div className="mt-1 font-display text-3xl font-semibold tabular-nums">{data?.length ?? 0}</div>
          <p className="mt-1 text-xs text-muted-foreground">Combined size {formatBytes((data ?? []).reduce((s, b) => s + b.sizeBytes, 0))}.</p>
        </Card>
      </div>

      <Card className="overflow-hidden border-border/60 bg-card/70 backdrop-blur">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((b) => (
              <TableRow key={b.id}>
                <TableCell className="mono text-xs">{new Date(b.createdAt).toLocaleString()}</TableCell>
                <TableCell><Badge variant="outline">{b.kind}</Badge></TableCell>
                <TableCell><Badge variant="outline" className="uppercase">{b.destination}</Badge></TableCell>
                <TableCell className="mono text-xs tabular-nums">{formatBytes(b.sizeBytes)}</TableCell>
                <TableCell>
                  <Badge variant="outline"
                    className={b.status === "ready" ? "border-primary/40 text-primary" : b.status === "failed" ? "border-destructive/40 text-destructive" : "border-warning/40 text-warning"}>
                    {b.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" title="Download"><Download className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" title="Restore" onClick={() => { if (confirm("Restore this backup? Current data will be replaced.")) restore.mutate(b.id); }}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Delete" onClick={() => { if (confirm("Delete backup?")) remove.mutate(b.id); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(!data || data.length === 0) && (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No backups yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
