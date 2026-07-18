// Web UI -> Python Agent API client with Lovable-preview mock fallback.

export type Protocol =
  | "ssh" | "vmess" | "vless" | "trojan"
  | "shadowsocks" | "hysteria2" | "tuic" | "wireguard" | "reality";

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  ssh: "SSH / WS",
  vmess: "VMess",
  vless: "VLESS",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
  hysteria2: "Hysteria2",
  tuic: "TUIC",
  wireguard: "WireGuard",
  reality: "VLESS-Reality",
};

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
  quotaGb: number;
  usedBytes: number;
  online: number;
  status: "active" | "expired" | "locked" | "trial";
  telegramId?: string;
  planId?: string;
  note?: string;
  cdn?: boolean;             // route through Cloudflare
  subscriptionToken?: string;
  trial?: boolean;
  nodeId?: string;
}

export type PlanMode = "prepaid" | "payg_gb" | "payg_day";

export interface Plan {
  id: string; name: string;
  mode: PlanMode;
  priceCents: number;
  durationDays: number;
  quotaGb: number;
  speedUpKbps: number;
  speedDnKbps: number;
  ipLimit: number;
  active: boolean;
}

export interface Payment {
  id: string;
  telegramId: string;
  telegramName?: string;
  planId?: string;
  planName?: string;
  amountCents: number;
  proofUrl?: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  note?: string;
  method?: "bank" | "crypto_usdt" | "stripe" | "wallet" | "manual";
}

export interface WalletTx {
  id: string; ts: string;
  amountCents: number;             // positive = credit, negative = debit
  reason: string;
  balanceAfterCents: number;
  telegramId?: string;
}

export interface Invoice {
  id: string;
  number: string;
  telegramId?: string;
  username: string;
  planName: string;
  amountCents: number;
  method: Payment["method"];
  issuedAt: string;
  paidAt?: string;
  pdfUrl: string;
}

export interface BotSettings {
  enabled: boolean;
  token: string;
  adminChatId: string;
  welcomeText: string;
  autoDeleteMinutes: number;
  paymentInstructions: string;
  paymentQrUrl?: string;
  running: boolean;
}

export interface PanelSettings {
  domain: string;
  port: number;
  tlsMode: "single" | "wildcard";
  dnsProvider?: string;
  rootDomain?: string;
  dbPath: string;
  repoUrl: string;
  cdn?: { enabled: boolean; provider: "cloudflare" | "custom"; realIpHeader: string };
  bbr?: boolean;
}

export interface SystemStatus {
  uptimeSeconds: number;
  cpuPercent: number;
  memoryPercent: number; memoryUsedMb: number; memoryTotalMb: number;
  diskPercent: number; diskUsedGb: number; diskTotalGb: number;
  netRxMbps: number; netTxMbps: number;
  services: { name: string; running: boolean }[];
  hostname: string; os: string; kernel: string; ipv4: string;
  loadAvg?: [number, number, number];
}

export interface TrafficPoint { t: string; rxBytes: number; txBytes: number; }

export interface LogEntry {
  id: string; ts: string;
  type: "audit" | "service" | "auth";
  level: "info" | "warn" | "error";
  actor?: string; action: string; target?: string; message: string;
}

export interface VersionInfo {
  currentCommit: string; currentDate: string;
  latestCommit: string; latestDate: string;
  behind: number; repo: string;
}

export interface LiveConnection {
  id: string;
  accountId: string;
  username: string;
  protocol: Protocol;
  ip: string;
  country: string;      // ISO2
  city?: string;
  device?: string;
  connectedAt: string;
  rxBytes: number;
  txBytes: number;
}

export interface Node {
  id: string;
  label: string;
  host: string;
  region: string;
  status: "online" | "offline" | "degraded";
  users: number;
  cpu: number;
  memory: number;
  bandwidthMbps: number;
  version: string;
  lastSeen: string;
}

export interface Backup {
  id: string;
  createdAt: string;
  sizeBytes: number;
  kind: "manual" | "scheduled";
  destination: "local" | "telegram" | "s3";
  status: "ready" | "uploading" | "failed";
  note?: string;
}

export interface Alert {
  id: string;
  ts: string;
  level: "info" | "warn" | "critical";
  source: string;         // "disk", "cert", "xray", "cpu", "login"
  message: string;
  acknowledged: boolean;
}


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
    async login(u: string, p: string) { return IS_PREVIEW ? mock.login(u, p) : req("/auth/login", { method: "POST", body: JSON.stringify({ username: u, password: p }) }); },
    async logout() { return IS_PREVIEW ? mock.logout() : req("/auth/logout", { method: "POST" }); },
    async me() { return IS_PREVIEW ? mock.me() : req<{ username: string } | null>("/auth/me"); },
  },
  system: {
    async status() { return IS_PREVIEW ? mock.status() : req<SystemStatus>("/system/status"); },
    async traffic(range: "1h" | "24h" | "7d" = "24h") { return IS_PREVIEW ? mock.traffic(range) : req<TrafficPoint[]>(`/system/traffic?range=${range}`); },
    async version() { return IS_PREVIEW ? mock.version() : req<VersionInfo>("/system/version"); },
    async update() { return IS_PREVIEW ? mock.update() : req<{ ok: true; commit: string }>("/system/update", { method: "POST" }); },
    async restartService(name: string) { return IS_PREVIEW ? mock.restartService(name) : req(`/system/services/${name}/restart`, { method: "POST" }); },
    async runSpeedtest() { return IS_PREVIEW ? mock.speedtest() : req<{ downMbps: number; upMbps: number; pingMs: number }>("/system/speedtest", { method: "POST" }); },
    async toggleBbr(on: boolean) { return IS_PREVIEW ? mock.toggleBbr(on) : req("/system/bbr", { method: "POST", body: JSON.stringify({ on }) }); },
  },
  accounts: {
    async list(protocol?: Protocol) { return IS_PREVIEW ? mock.listAccounts(protocol) : req<Account[]>(`/accounts${protocol ? `?protocol=${protocol}` : ""}`); },
    async get(id: string) { return IS_PREVIEW ? mock.getAccount(id) : req<Account>(`/accounts/${id}`); },
    async create(input: Partial<Account>) { return IS_PREVIEW ? mock.createAccount(input) : req<Account>("/accounts", { method: "POST", body: JSON.stringify(input) }); },
    async update(id: string, input: Partial<Account>) { return IS_PREVIEW ? mock.updateAccount(id, input) : req<Account>(`/accounts/${id}`, { method: "PATCH", body: JSON.stringify(input) }); },
    async remove(id: string) { return IS_PREVIEW ? mock.removeAccount(id) : req(`/accounts/${id}`, { method: "DELETE" }); },
    async bulk(action: "extend" | "delete" | "lock" | "unlock", ids: string[], days?: number) {
      return IS_PREVIEW ? mock.bulkAccounts(action, ids, days) : req("/accounts/bulk", { method: "POST", body: JSON.stringify({ action, ids, days }) });
    },
    async config(id: string) { return IS_PREVIEW ? mock.accountConfig(id) : req<{ link: string; text: string }>(`/accounts/${id}/config`); },
    async subscriptionUrl(id: string) { return IS_PREVIEW ? mock.subscriptionUrl(id) : req<{ url: string }>(`/accounts/${id}/subscription`); },
    async importCsv(csv: string) { return IS_PREVIEW ? mock.importCsv(csv) : req<{ created: number }>("/accounts/import", { method: "POST", body: JSON.stringify({ csv }) }); },
    async exportCsv() { return IS_PREVIEW ? mock.exportCsv() : req<{ csv: string }>("/accounts/export"); },
    async sendTelegram(id: string) { return IS_PREVIEW ? mock.sendTelegram(id) : req(`/accounts/${id}/telegram`, { method: "POST" }); },
  },
  connections: {
    async list() { return IS_PREVIEW ? mock.listConnections() : req<LiveConnection[]>("/connections"); },
    async kick(id: string) { return IS_PREVIEW ? mock.kickConnection(id) : req(`/connections/${id}/kick`, { method: "POST" }); },
  },
  nodes: {
    async list() { return IS_PREVIEW ? mock.listNodes() : req<Node[]>("/nodes"); },
    async add(n: Partial<Node>) { return IS_PREVIEW ? mock.addNode(n) : req<Node>("/nodes", { method: "POST", body: JSON.stringify(n) }); },
    async remove(id: string) { return IS_PREVIEW ? mock.removeNode(id) : req(`/nodes/${id}`, { method: "DELETE" }); },
  },
  backups: {
    async list() { return IS_PREVIEW ? mock.listBackups() : req<Backup[]>("/backups"); },
    async create(destination: Backup["destination"]) { return IS_PREVIEW ? mock.createBackup(destination) : req<Backup>("/backups", { method: "POST", body: JSON.stringify({ destination }) }); },
    async restore(id: string) { return IS_PREVIEW ? mock.restoreBackup(id) : req(`/backups/${id}/restore`, { method: "POST" }); },
    async remove(id: string) { return IS_PREVIEW ? mock.removeBackup(id) : req(`/backups/${id}`, { method: "DELETE" }); },
  },
  alerts: {
    async list() { return IS_PREVIEW ? mock.listAlerts() : req<Alert[]>("/alerts"); },
    async ack(id: string) { return IS_PREVIEW ? mock.ackAlert(id) : req(`/alerts/${id}/ack`, { method: "POST" }); },
  },
  wallet: {
    async list() { return IS_PREVIEW ? mock.listWallet() : req<WalletTx[]>("/wallet"); },
    async balance() { return IS_PREVIEW ? mock.walletBalance() : req<{ balanceCents: number }>("/wallet/balance"); },
    async credit(amountCents: number, reason: string) { return IS_PREVIEW ? mock.creditWallet(amountCents, reason) : req("/wallet/credit", { method: "POST", body: JSON.stringify({ amountCents, reason }) }); },
  },
  invoices: {
    async list() { return IS_PREVIEW ? mock.listInvoices() : req<Invoice[]>("/invoices"); },
    async send(id: string, via: "email" | "telegram") { return IS_PREVIEW ? mock.sendInvoice(id, via) : req(`/invoices/${id}/send`, { method: "POST", body: JSON.stringify({ via }) }); },
  },
  resellers: {
    async list() { return IS_PREVIEW ? mock.listResellers() : req<Reseller[]>("/resellers"); },
    async save(r: Partial<Reseller>) { return IS_PREVIEW ? mock.saveReseller(r) : req<Reseller>("/resellers", { method: "POST", body: JSON.stringify(r) }); },
  },
  plans: {
    async list() { return IS_PREVIEW ? mock.listPlans() : req<Plan[]>("/plans"); },
    async save(p: Partial<Plan>) { return IS_PREVIEW ? mock.savePlan(p) : req<Plan>("/plans", { method: p.id ? "PATCH" : "POST", body: JSON.stringify(p) }); },
    async remove(id: string) { return IS_PREVIEW ? mock.removePlan(id) : req(`/plans/${id}`, { method: "DELETE" }); },
  },
  payments: {
    async list(status?: Payment["status"]) { return IS_PREVIEW ? mock.listPayments(status) : req<Payment[]>(`/payments${status ? `?status=${status}` : ""}`); },
    async decide(id: string, s: Payment["status"], reason?: string) { return IS_PREVIEW ? mock.decidePayment(id, s, reason) : req(`/payments/${id}/decide`, { method: "POST", body: JSON.stringify({ status: s, reason }) }); },
  },
  bot: {
    async get() { return IS_PREVIEW ? mock.botGet() : req<BotSettings>("/bot"); },
    async save(s: Partial<BotSettings>) { return IS_PREVIEW ? mock.botSave(s) : req<BotSettings>("/bot", { method: "PATCH", body: JSON.stringify(s) }); },
    async restart() { return IS_PREVIEW ? mock.botRestart() : req("/bot/restart", { method: "POST" }); },
  },
  settings: {
    async get() { return IS_PREVIEW ? mock.settingsGet() : req<PanelSettings>("/settings"); },
    async save(s: Partial<PanelSettings>) { return IS_PREVIEW ? mock.settingsSave(s) : req<PanelSettings>("/settings", { method: "PATCH", body: JSON.stringify(s) }); },
    async changePassword(current: string, next: string) { return IS_PREVIEW ? Promise.resolve({ ok: true as const }) : req("/settings/password", { method: "POST", body: JSON.stringify({ current, next }) }); },
  },
  logs: {
    async list(type?: "audit" | "service" | "auth") { return IS_PREVIEW ? mock.logs(type) : req<LogEntry[]>(`/logs${type ? `?type=${type}` : ""}`); },
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
