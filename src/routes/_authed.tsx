import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_authed")({
  ssr: false,
  beforeLoad: async () => {
    const me = await api.auth.me();
    if (!me) throw redirect({ to: "/login" });
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
