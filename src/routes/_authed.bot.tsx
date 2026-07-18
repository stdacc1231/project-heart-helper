import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { api, type BotSettings } from "@/lib/api";
import { toast } from "sonner";

export const Route = createFileRoute("/_authed/bot")({
  head: () => ({ meta: [{ title: "Telegram Bot — Autoscript Panel" }] }),
  component: BotPage,
});

function BotPage() {
  const { data } = useQuery({ queryKey: ["bot"], queryFn: () => api.bot.get() });
  const [f, setF] = useState<Partial<BotSettings>>({});
  useEffect(() => { if (data) setF(data); }, [data]);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api.bot.save(f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot"] }); toast.success("Bot settings saved"); },
  });
  const restart = useMutation({
    mutationFn: () => api.bot.restart(),
    onSuccess: () => toast.success("Bot restarted"),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Telegram bot</h3>
            <p className="text-xs text-muted-foreground">Users buy plans, upload proof, receive configs through this bot.</p>
          </div>
          <Badge variant={data?.running ? "secondary" : "destructive"}>{data?.running ? "running" : "stopped"}</Badge>
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <Label>Enabled</Label>
          <Switch checked={f.enabled ?? false} onCheckedChange={(v) => setF({ ...f, enabled: v })} />
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <h3 className="text-sm font-medium">Credentials</h3>
        <div className="space-y-1.5">
          <Label>Bot token</Label>
          <Input placeholder="123456:ABC…" value={f.token ?? ""} onChange={(e) => setF({ ...f, token: e.target.value })} />
          <p className="text-xs text-muted-foreground">Get one from @BotFather.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Admin chat ID</Label>
          <Input placeholder="e.g. 123456789" value={f.adminChatId ?? ""} onChange={(e) => setF({ ...f, adminChatId: e.target.value })} />
          <p className="text-xs text-muted-foreground">Receives notifications for new payments.</p>
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <h3 className="text-sm font-medium">User experience</h3>
        <div className="space-y-1.5">
          <Label>Welcome message</Label>
          <Textarea rows={3} value={f.welcomeText ?? ""} onChange={(e) => setF({ ...f, welcomeText: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Payment instructions</Label>
          <Textarea rows={5} value={f.paymentInstructions ?? ""} onChange={(e) => setF({ ...f, paymentInstructions: e.target.value })} />
          <p className="text-xs text-muted-foreground">Shown when a user picks a plan (QRIS, bank, crypto address, etc.).</p>
        </div>
        <div className="space-y-1.5">
          <Label>Payment QR image URL (optional)</Label>
          <Input value={f.paymentQrUrl ?? ""} onChange={(e) => setF({ ...f, paymentQrUrl: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Auto-delete sensitive messages after (minutes)</Label>
          <Input type="number" value={f.autoDeleteMinutes ?? 10} onChange={(e) => setF({ ...f, autoDeleteMinutes: +e.target.value })} />
          <p className="text-xs text-muted-foreground">Configs, payment details, and receipts are removed from Telegram after this many minutes. Default 10.</p>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save settings</Button>
        <Button variant="outline" onClick={() => restart.mutate()} disabled={restart.isPending}>Restart bot</Button>
      </div>
    </div>
  );
}
