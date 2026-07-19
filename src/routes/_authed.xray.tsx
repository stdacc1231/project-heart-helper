import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, RefreshCw, Save, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/xray")({
  head: () => ({ meta: [{ title: "Xray core — GRVPN Panel" }] }),
  component: XrayPage,
});

function XrayPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["xray", "status"], queryFn: () => api.xray.status(), refetchInterval: 5000 });
  const versions = useQuery({ queryKey: ["xray", "versions"], queryFn: () => api.xray.versions() });
  const [target, setTarget] = useState<string>("latest");

  const install = useMutation({
    mutationFn: (v: string) => api.xray.install(v),
    onSuccess: (r) => { toast.success(`Xray installed: ${r.version}`); qc.invalidateQueries({ queryKey: ["xray"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const restart = useMutation({
    mutationFn: () => api.xray.restart(),
    onSuccess: () => { toast.success("Xray restarted"); qc.invalidateQueries({ queryKey: ["xray"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const active = status.data?.active;
  const activeColor = active === "active" ? "bg-emerald-500" : active ? "bg-amber-500" : "bg-muted";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Cpu className="h-6 w-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">Xray core</h2>
              <p className="text-sm text-muted-foreground">Manage the xray binary, transports and live configuration.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={activeColor + " text-white"}>{active ?? "…"}</Badge>
            <Badge variant="secondary" className="font-mono">{status.data?.version ?? "…"}</Badge>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger><SelectValue placeholder="Pick a version" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">latest (recommended)</SelectItem>
              {versions.data?.available.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => install.mutate(target)} disabled={install.isPending}>
            {install.isPending ? "Installing…" : "Install / downgrade"}
          </Button>
          <Button variant="outline" onClick={() => restart.mutate()} disabled={restart.isPending}>
            <Play className="mr-1 h-4 w-4" /> Restart
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Transports enabled: VMess / VLESS / Trojan over <b>WebSocket</b>, <b>xHTTP</b> and <b>HTTPUpgrade</b>, plus SSH-WS on <span className="font-mono">/</span>.
        </p>
      </Card>

      <Tabs defaultValue="access">
        <TabsList>
          <TabsTrigger value="access">Access log</TabsTrigger>
          <TabsTrigger value="error">Error log</TabsTrigger>
          <TabsTrigger value="config">config.json</TabsTrigger>
        </TabsList>
        <TabsContent value="access"><LogTab kind="access" /></TabsContent>
        <TabsContent value="error"><LogTab kind="error" /></TabsContent>
        <TabsContent value="config"><ConfigTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function LogTab({ kind }: { kind: "access" | "error" }) {
  const q = useQuery({
    queryKey: ["xray", "logs", kind],
    queryFn: () => api.xray.logs(kind, 400),
    refetchInterval: 4000,
  });
  return (
    <Card className="mt-3 p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">{q.data?.path}</span>
        <Button size="sm" variant="ghost" onClick={() => q.refetch()}><RefreshCw className="h-3 w-3" /></Button>
      </div>
      <pre className="max-h-[520px] overflow-auto rounded bg-black/40 p-3 text-xs leading-relaxed">
        {q.data?.content || "(no output)"}
      </pre>
    </Card>
  );
}

function ConfigTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["xray", "config"], queryFn: () => api.xray.config() });
  const [text, setText] = useState("");
  useEffect(() => { if (q.data) setText(JSON.stringify(q.data.config, null, 2)); }, [q.data]);
  const save = useMutation({
    mutationFn: (v: unknown) => api.xray.saveConfig(v),
    onSuccess: () => { toast.success("Config saved and xray restarted"); qc.invalidateQueries({ queryKey: ["xray"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Card className="mt-3 p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">{q.data?.path}</span>
        <Button
          size="sm"
          onClick={() => {
            try { save.mutate(JSON.parse(text)); }
            catch (e) { toast.error("Invalid JSON: " + (e as Error).message); }
          }}
          disabled={save.isPending}
        >
          <Save className="mr-1 h-3 w-3" /> {save.isPending ? "Saving…" : "Save & restart"}
        </Button>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="min-h-[520px] font-mono text-xs"
      />
    </Card>
  );
}
