// Web UI -> Python Agent API client.
// The agent runs on the same VPS as the panel (Nginx proxies /api/* -> localhost:8088).
// In Lovable preview there is no agent, so we fall back to mock data so every page is clickable.

export type Protocol = "ssh" | "vmess" | "vless" | "trojan";
export type PlanMode = "prepaid" | "payg_gb" | "payg_day";

export interface Plan {
  id: string;
  name: string;
  mode: PlanMode;
  priceCents: number;   // fixed price for prepaid, per-GB or per-day for payg
  durationDays: number; // prepaid only
  quotaGb: number;      // 0 = unlimited (prepaid) or included allowance (payg)
  speedUpKbps: number;
  speedDnKbps: number;
  ipLimit: number;
  active: boolean;
}

export interface Account {
  id: string;
  protocol: Protocol;
  username: string;
  password?: string;
  uuid?: string;
  expiresAt: string;
  createdAt: string;
  ipLimit: number;
  speedUpKbps: number;
  speedDnKbps: number;
  quotaGb: number;      // 0 = unlimited
  usedBytes: number;
  online: number;
  status: "active" | "expired" | "locked";
  telegramId?: string;
  planId?: string;
  note?: string;
}

export interface Payment {
  id: string;
  telegramId: string;
  telegramName: string;
  planId: string;
  planName: string;
  amountCents: number;
  proofUrl: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  note?: string;
}

export interface SystemStatus {
  uptimeSeconds: number;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  diskPercent: number;
  diskUsedGb: number;
  diskTotalGb: number;
  netRxMbps: number;
  netTxMbps: number;
  services: { name: string; running: boolean }[];
  hostname: string;
  os: string;
  kernel: string;
  ipv4: string;
}

export interface TrafficPoint {
  t: string;
  rxBytes: number;
  txBytes: number;
}

export interface LogEntry {
  id: string;
  ts: string;
  type: "audit" | "service" | "auth";
  level: "info" | "warn" | "error";
  actor?: string;
  action: string;
  target?: string;
  message: string;
}

export interface VersionInfo {
  currentCommit: string;
  currentDate: string;
  latestCommit: string;
  latestDate: string;
  behind: number;
  repo: string;
}

export interface BotSettings {
  enabled: boolean;
  token: string;
  adminChatId: string;
  welcomeText: string;
  autoDeleteMinutes: number;
  paymentInstructions: string;   // QRIS text / bank / crypto
  paymentQrUrl?: string;
  running: boolean;
}

export interface PanelSettings {
  domain: string;
  port: number;
  tlsMode: "single" | "wildcard";
  dnsProvider?: string;   // acme.sh module, e.g. dns_cf
  rootDomain?: string;    // for wildcard
  dbPath: string;
  repoUrl: string;
}

// Treat SSR and Lovable preview as "no real backend" — use mocks.
const IS_PREVIEW =
  typeof window === "undefined" ||
  /lovable\.(app|dev)$|lovableproject\.com$|localhost/.test(window.location.hostname);

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

import { mock } from "./mock";

export const api = {
  auth: {
    async login(username: string, password: string) {
      if (IS_PREVIEW) return mock.login(username, password);
      return req<{ ok: true }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    },
    async logout() {
      if (IS_PREVIEW) return mock.logout();
      return req<{ ok: true }>("/auth/logout", { method: "POST" });
    },
    async me() {
      if (IS_PREVIEW) return mock.me();
      return req<{ username: string } | null>("/auth/me");
    },
  },
  system: {
    async status() { return IS_PREVIEW ? mock.status() : req<SystemStatus>("/system/status"); },
    async traffic(range: "1h" | "24h" | "7d" = "24h") {
      if (IS_PREVIEW) return mock.traffic(range);
      return req<TrafficPoint[]>(`/system/traffic?range=${range}`);
    },
    async version() { return IS_PREVIEW ? mock.version() : req<VersionInfo>("/system/version"); },
    async update() {
      if (IS_PREVIEW) return mock.update();
      return req<{ ok: true; commit: string }>("/system/update", { method: "POST" });
    },
    async restart(svc: string) {
      if (IS_PREVIEW) return { ok: true as const };
      return req<{ ok: true }>(`/system/restart/${svc}`, { method: "POST" });
    },
  },
  accounts: {
    async list(protocol?: Protocol) {
      if (IS_PREVIEW) return mock.listAccounts(protocol);
      const q = protocol ? `?protocol=${protocol}` : "";
      return req<Account[]>(`/accounts${q}`);
    },
    async get(id: string) { return IS_PREVIEW ? mock.getAccount(id) : req<Account>(`/accounts/${id}`); },
    async create(input: Partial<Account>) {
      if (IS_PREVIEW) return mock.createAccount(input);
      return req<Account>("/accounts", { method: "POST", body: JSON.stringify(input) });
    },
    async update(id: string, input: Partial<Account>) {
      if (IS_PREVIEW) return mock.updateAccount(id, input);
      return req<Account>(`/accounts/${id}`, { method: "PATCH", body: JSON.stringify(input) });
    },
    async remove(id: string) {
      if (IS_PREVIEW) return mock.removeAccount(id);
      return req<{ ok: true }>(`/accounts/${id}`, { method: "DELETE" });
    },
    async config(id: string) {
      if (IS_PREVIEW) return mock.accountConfig(id);
      return req<{ link: string; text: string }>(`/accounts/${id}/config`);
    },
    async sendToTelegram(id: string) {
      if (IS_PREVIEW) return { ok: true as const };
      return req<{ ok: true }>(`/accounts/${id}/send-telegram`, { method: "POST" });
    },
  },
  plans: {
    async list() { return IS_PREVIEW ? mock.listPlans() : req<Plan[]>("/plans"); },
    async save(p: Partial<Plan>) {
      if (IS_PREVIEW) return mock.savePlan(p);
      const method = p.id ? "PATCH" : "POST";
      const path = p.id ? `/plans/${p.id}` : "/plans";
      return req<Plan>(path, { method, body: JSON.stringify(p) });
    },
    async remove(id: string) {
      if (IS_PREVIEW) return mock.removePlan(id);
      return req<{ ok: true }>(`/plans/${id}`, { method: "DELETE" });
    },
  },
  payments: {
    async list(statusFilter?: Payment["status"]) {
      if (IS_PREVIEW) return mock.listPayments(statusFilter);
      const q = statusFilter ? `?status=${statusFilter}` : "";
      return req<Payment[]>(`/payments${q}`);
    },
    async approve(id: string) {
      if (IS_PREVIEW) return mock.decidePayment(id, "approved");
      return req<{ ok: true }>(`/payments/${id}/approve`, { method: "POST" });
    },
    async reject(id: string, reason?: string) {
      if (IS_PREVIEW) return mock.decidePayment(id, "rejected", reason);
      return req<{ ok: true }>(`/payments/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
    },
  },
  bot: {
    async get() { return IS_PREVIEW ? mock.botGet() : req<BotSettings>("/bot"); },
    async save(s: Partial<BotSettings>) {
      if (IS_PREVIEW) return mock.botSave(s);
      return req<BotSettings>("/bot", { method: "PATCH", body: JSON.stringify(s) });
    },
    async restart() {
      if (IS_PREVIEW) return mock.botRestart();
      return req<{ ok: true }>("/bot/restart", { method: "POST" });
    },
  },
  settings: {
    async get() { return IS_PREVIEW ? mock.settingsGet() : req<PanelSettings>("/settings"); },
    async save(s: Partial<PanelSettings>) {
      if (IS_PREVIEW) return mock.settingsSave(s);
      return req<PanelSettings>("/settings", { method: "PATCH", body: JSON.stringify(s) });
    },
    async changePassword(current: string, next: string) {
      if (IS_PREVIEW) return { ok: true as const };
      return req<{ ok: true }>("/settings/password", { method: "POST", body: JSON.stringify({ current, next }) });
    },
  },
  logs: {
    async list(type?: "audit" | "service" | "auth") {
      if (IS_PREVIEW) return mock.logs(type);
      const q = type ? `?type=${type}` : "";
      return req<LogEntry[]>(`/logs${q}`);
    },
  },
};

export function formatBytes(n: number) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 2 : 0)} ${u[i]}`;
}

export function formatDuration(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

export function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
