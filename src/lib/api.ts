// Web UI -> Python Agent API client.
// The agent runs on the same VPS as the panel (Nginx proxies /api/* -> localhost:8088).
// In Lovable preview there is no agent, so we fall back to mock data so every page is clickable.

export type Protocol = "ssh" | "vmess" | "vless" | "trojan";

export interface Account {
  id: string;
  protocol: Protocol;
  username: string;
  password?: string;
  uuid?: string;
  expiresAt: string;
  createdAt: string;
  ipLimit: number;
  speedLimitKbps: number; // 0 = unlimited
  quotaGb: number; // 0 = unlimited
  usedBytes: number;
  online: number;
  status: "active" | "expired" | "locked";
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

// Treat SSR and Lovable preview as "no real backend" — use mocks.
const IS_PREVIEW =
  typeof window === "undefined" ||
  /lovable\.(app|dev)$|lovableproject\.com$|localhost/.test(window.location.hostname);

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// ---------- MOCK DATA (Lovable preview only) ----------
import { mock } from "./mock";

export const api = {
  auth: {
    async login(username: string, password: string) {
      if (IS_PREVIEW) return mock.login(username, password);
      return req<{ ok: true }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
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
    async status() {
      if (IS_PREVIEW) return mock.status();
      return req<SystemStatus>("/system/status");
    },
    async traffic(range: "1h" | "24h" | "7d" = "24h") {
      if (IS_PREVIEW) return mock.traffic(range);
      return req<TrafficPoint[]>(`/system/traffic?range=${range}`);
    },
    async version() {
      if (IS_PREVIEW) return mock.version();
      return req<VersionInfo>("/system/version");
    },
    async update() {
      if (IS_PREVIEW) return mock.update();
      return req<{ ok: true; commit: string }>("/system/update", { method: "POST" });
    },
  },
  accounts: {
    async list(protocol?: Protocol) {
      if (IS_PREVIEW) return mock.listAccounts(protocol);
      const q = protocol ? `?protocol=${protocol}` : "";
      return req<Account[]>(`/accounts${q}`);
    },
    async get(id: string) {
      if (IS_PREVIEW) return mock.getAccount(id);
      return req<Account>(`/accounts/${id}`);
    },
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
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}
