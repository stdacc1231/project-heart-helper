import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Users, ScrollText, Settings, RefreshCw, LogOut, Menu,
  CreditCard, Package, Bot, Activity, Cloud, HardDrive, BellRing,
  Wallet, FileText, ShieldCheck, Sun, Moon,
} from "lucide-react";


import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";

type NavItem = { to: string; label: string; icon: typeof Users };
type NavGroup = { label: string; items: NavItem[] };

const groups: NavGroup[] = [
  { label: "Overview", items: [
    { to: "/",            label: "Dashboard",    icon: LayoutDashboard },
    { to: "/connections", label: "Live",         icon: Activity },
    { to: "/alerts",      label: "Alerts",       icon: BellRing },
  ]},
  { label: "Users", items: [
    { to: "/accounts",    label: "Accounts",     icon: Users },
    { to: "/plans",       label: "Plans",        icon: Package },
  ]},
  { label: "Billing", items: [
    { to: "/payments",    label: "Payments",     icon: CreditCard },
    { to: "/invoices",    label: "Invoices",     icon: FileText },
    { to: "/wallet",      label: "Wallet",       icon: Wallet },
  ]},
  { label: "System", items: [
    { to: "/cdns",        label: "CDN endpoints",icon: Cloud },
    { to: "/backups",     label: "Backups",      icon: HardDrive },
    { to: "/bot",         label: "Telegram Bot", icon: Bot },
    { to: "/logs",        label: "Logs",         icon: ScrollText },
    { to: "/update",      label: "Update",       icon: RefreshCw },
    { to: "/settings",    label: "Settings",     icon: Settings },
  ]},
];



export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const t = (typeof localStorage !== "undefined" && localStorage.getItem("theme")) === "light" ? "light" : "dark";
    setTheme(t);
  }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    const d = document.documentElement;
    d.classList.toggle("dark", next === "dark");
    d.classList.toggle("light", next === "light");
    try { localStorage.setItem("theme", next); } catch {}
  };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.auth.me() });
  const { data: alerts } = useQuery({ queryKey: ["alerts"], queryFn: () => api.alerts.list(), refetchInterval: 15000 });
  const unread = (alerts ?? []).filter((a) => !a.acknowledged).length;
  const logout = useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => { qc.clear(); toast.success("Signed out"); navigate({ to: "/login" }); },
  });

  const active = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));
  const currentLabel = groups.flatMap((g) => g.items).find((i) => active(i.to))?.label ?? "Dashboard";


  return (
    <div className="min-h-screen aurora-bg text-foreground">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 border-r border-sidebar-border bg-sidebar/95 backdrop-blur-xl transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary via-chart-3 to-accent text-primary-foreground shadow-lg">
            <ShieldCheck className="h-4.5 w-4.5" />
            <span className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full bg-primary shadow-[0_0_10px_var(--color-primary)]" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold tracking-tight aurora-text">AUTOSCRIPT</div>
            <div className="mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Ops Panel</div>
          </div>
        </div>

        <nav className="flex flex-col gap-4 overflow-y-auto p-3 pb-24" style={{ maxHeight: "calc(100vh - 4rem)" }}>
          {groups.map((g) => (
            <div key={g.label} className="flex flex-col gap-0.5">
              <div className="mono px-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">{g.label}</div>
              {g.items.map((item) => {
                const isActive = active(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                    )}
                  >
                    {isActive && (
                      <span className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-gradient-to-b from-primary via-chart-3 to-accent shadow-[0_0_10px_var(--color-primary)]" />
                    )}
                    <item.icon className={cn("h-4 w-4 transition-transform", isActive && "text-primary")} />
                    <span className="flex-1">{item.label}</span>
                    {item.to === "/alerts" && unread > 0 && (
                      <span className="mono rounded-full bg-destructive/20 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                        {unread}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="absolute inset-x-0 bottom-0 border-t border-sidebar-border bg-sidebar/95 p-3 backdrop-blur">
          <div className="flex items-center gap-2 rounded-lg border border-sidebar-border bg-background/40 p-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent text-primary-foreground text-xs font-bold">
              {(me?.username ?? "A").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 text-xs">
              <div className="truncate font-medium">{me?.username ?? "guest"}</div>
              <div className="mono text-[10px] uppercase text-muted-foreground">Administrator</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => logout.mutate()} aria-label="Sign out" className="h-8 w-8">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">/panel</div>
            <div className="font-display text-lg font-semibold leading-none">{currentLabel}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <div className="mono hidden items-center gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-1.5 text-xs md:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]" />
              <span className="text-muted-foreground">agent</span>
              <span>online</span>
            </div>
          </div>

          </div>

        </header>
        <main className="p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
