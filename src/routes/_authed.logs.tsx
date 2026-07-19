import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authed/logs")({
  head: () => ({ meta: [{ title: "Logs — GRVPN Panel" }] }),
  component: LogsPage,
});

function LogsPage() {
  const [type, setType] = useState<"all" | "audit" | "service" | "auth">("all");
  const { data } = useQuery({
    queryKey: ["logs", type],
    queryFn: () => api.logs.list(type === "all" ? undefined : type),
    refetchInterval: 10000,
  });

  return (
    <div className="space-y-4">
      <Tabs value={type} onValueChange={(v) => setType(v as any)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="auth">Auth</TabsTrigger>
          <TabsTrigger value="service">Service</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="divide-y">
        {(data ?? []).map((l) => (
          <div key={l.id} className="flex items-start gap-3 px-4 py-3">
            <div className="w-40 shrink-0 text-xs text-muted-foreground">
              {new Date(l.ts).toLocaleString()}
            </div>
            <Badge variant="outline" className="w-16 justify-center">{l.type}</Badge>
            <Badge
              variant={l.level === "error" ? "destructive" : l.level === "warn" ? "default" : "secondary"}
              className="w-16 justify-center"
            >
              {l.level}
            </Badge>
            <div className="flex-1 text-sm">
              <div className="font-mono text-xs text-muted-foreground">{l.actor ?? "system"} · {l.action}</div>
              <div>{l.message}</div>
            </div>
          </div>
        ))}
        {(data ?? []).length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">No logs.</div>
        )}
      </Card>
    </div>
  );
}
