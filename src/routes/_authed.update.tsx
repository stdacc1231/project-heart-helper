import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, GitCommit, ArrowUpCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/update")({
  head: () => ({ meta: [{ title: "Update — Autoscript Panel" }] }),
  component: UpdatePage,
});

function UpdatePage() {
  const { data: v, isLoading } = useQuery({ queryKey: ["version"], queryFn: () => api.system.version() });
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api.system.update(),
    onSuccess: () => {
      toast.success("Updated. Services restarted.");
      qc.invalidateQueries({ queryKey: ["version"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const behind = v?.behind ?? 0;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Script version</h2>
            <p className="text-sm text-muted-foreground">Source: <span className="font-mono">{v?.repo ?? "—"}</span></p>
          </div>
          <RefreshCw className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="mt-6 space-y-3">
          <Row icon={GitCommit} label="Installed" commit={v?.currentCommit} date={v?.currentDate} />
          <Row icon={ArrowUpCircle} label="Latest" commit={v?.latestCommit} date={v?.latestDate} highlight={behind > 0} />
        </div>

        <div className="mt-6 flex items-center justify-between border-t pt-4">
          {behind > 0 ? (
            <Badge className="bg-amber-500 text-white">{behind} commit{behind > 1 ? "s" : ""} behind</Badge>
          ) : (
            <Badge variant="secondary">Up to date</Badge>
          )}
          <Button onClick={() => run.mutate()} disabled={run.isPending || isLoading || behind === 0}>
            {run.isPending ? "Updating…" : "Update now"}
          </Button>
        </div>
      </Card>

      <Card className="p-4 text-xs text-muted-foreground">
        Running <span className="font-mono">POST /api/system/update</span> triggers <span className="font-mono">git fetch && git reset --hard origin/main</span>{" "}
        on the VPS, applies any migrations, and restarts <span className="font-mono">autoscript-agent</span> and <span className="font-mono">nginx</span>. The web UI
        is served from the repo's shipped <span className="font-mono">dist/</span>, so no Node build is needed on the VPS.
      </Card>
    </div>
  );
}

function Row({ icon: Icon, label, commit, date, highlight }: { icon: any; label: string; commit?: string; date?: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-md border px-3 py-2 ${highlight ? "border-primary/60 bg-primary/5" : ""}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">{label}</span>
      </div>
      <div className="text-right text-sm">
        <div className="font-mono">{commit ?? "—"}</div>
        <div className="text-xs text-muted-foreground">{date ? new Date(date).toLocaleString() : "—"}</div>
      </div>
    </div>
  );
}
