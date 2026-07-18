// Mock backend for Lovable preview. On the VPS the real Python agent replaces this.
import type {
  Account, BotSettings, LogEntry, PanelSettings, Payment, Plan, Protocol,
  SystemStatus, TrafficPoint, VersionInfo,
} from "./api";

const STORAGE = "autoscript_mock_v2";

interface MockDB {
  loggedIn: boolean;
  accounts: Account[];
  logs: LogEntry[];
  plans: Plan[];
  payments: Payment[];
  bot: BotSettings;
  settings: PanelSettings;
  startedAt: number;
}

function load(): MockDB {
  if (typeof window === "undefined") return seed();
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) return JSON.parse(raw);
  } catch {}
  const db = seed();
  localStorage.setItem(STORAGE, JSON.stringify(db));
  return db;
}
function save(db: MockDB) {
  if (typeof window !== "undefined") localStorage.setItem(STORAGE, JSON.stringify(db));
}

function seed(): MockDB {
  const now = Date.now();
  const day = 86400_000;
  const plans: Plan[] = [
    { id: "p-basic", name: "Basic 30d", mode: "prepaid", priceCents: 300, durationDays: 30, quotaGb: 100, speedUpKbps: 5000, speedDnKbps: 5000, ipLimit: 2, active: true },
    { id: "p-pro",   name: "Pro 30d",   mode: "prepaid", priceCents: 700, durationDays: 30, quotaGb: 0,   speedUpKbps: 0,    speedDnKbps: 0,    ipLimit: 3, active: true },
    { id: "p-payg",  name: "Pay-as-you-go", mode: "payg_gb", priceCents: 10, durationDays: 0, quotaGb: 0, speedUpKbps: 0, speedDnKbps: 0, ipLimit: 2, active: true },
  ];
  const mk = (i: number, protocol: Protocol): Account => ({
    id: `${protocol}-${i}`,
    protocol,
    username: `${protocol}user${i}`,
    password: protocol === "ssh" ? "pass" + i : undefined,
    uuid: protocol !== "ssh" ? crypto.randomUUID() : undefined,
    createdAt: new Date(now - (10 - i) * day).toISOString(),
    expiresAt: new Date(now + (30 - i) * day).toISOString(),
    ipLimit: 2,
    speedUpKbps: i % 3 === 0 ? 0 : 5000,
    speedDnKbps: i % 3 === 0 ? 0 : 5000,
    quotaGb: i % 2 === 0 ? 0 : 100,
    usedBytes: Math.floor(Math.random() * 50 * 1024 ** 3),
    online: Math.random() > 0.6 ? Math.floor(Math.random() * 3) + 1 : 0,
    status: "active",
    telegramId: i % 2 ? String(500000000 + i * 137) : undefined,
    planId: plans[i % plans.length].id,
  });
  const accounts: Account[] = [];
  (["ssh", "vmess", "vless", "trojan"] as Protocol[]).forEach((p) => {
    for (let i = 1; i <= 4; i++) accounts.push(mk(i, p));
  });
  const logs: LogEntry[] = accounts.slice(0, 8).map((a, i) => ({
    id: "l" + i,
    ts: new Date(now - i * 3600_000).toISOString(),
    type: i % 3 === 0 ? "auth" : "audit",
    level: "info",
    actor: "admin",
    action: i % 2 ? "account.create" : "account.update",
    target: a.username,
    message: `${i % 2 ? "Created" : "Updated"} ${a.protocol} account ${a.username}`,
  }));
  const payments: Payment[] = [
    { id: "pay-1", telegramId: "500000123", telegramName: "@alice", planId: "p-basic", planName: "Basic 30d", amountCents: 300, proofUrl: "https://placehold.co/400x600?text=Proof", createdAt: new Date(now - 3600_000).toISOString(), status: "pending" },
    { id: "pay-2", telegramId: "500000999", telegramName: "@bob",   planId: "p-pro",   planName: "Pro 30d",   amountCents: 700, proofUrl: "https://placehold.co/400x600?text=Proof", createdAt: new Date(now - 7200_000).toISOString(), status: "pending" },
    { id: "pay-3", telegramId: "500000555", telegramName: "@carol", planId: "p-basic", planName: "Basic 30d", amountCents: 300, proofUrl: "https://placehold.co/400x600?text=Proof", createdAt: new Date(now - 86400_000).toISOString(), status: "approved" },
  ];
  const bot: BotSettings = {
    enabled: true, token: "", adminChatId: "",
    welcomeText: "Welcome! Tap a plan below to purchase.",
    autoDeleteMinutes: 10,
    paymentInstructions: "Scan QRIS or send to bank BCA 1234567890 a/n Autoscript.\nAfter payment, upload the receipt here.",
    running: true,
  };
  const settings: PanelSettings = {
    domain: "panel.example.com", port: 443, tlsMode: "single",
    dnsProvider: "dns_cf", rootDomain: "example.com",
    dbPath: "/etc/autoscript/db.sqlite", repoUrl: "https://github.com/your-user/autoscript.git",
  };
  return { loggedIn: false, accounts, logs, plans, payments, bot, settings, startedAt: now - 3 * day };
}

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export const mock = {
  async login(username: string, password: string) {
    await wait();
    if (!username || !password) throw new Error("Invalid credentials");
    const db = load(); db.loggedIn = true; save(db);
    return { ok: true as const };
  },
  async logout() { const db = load(); db.loggedIn = false; save(db); return { ok: true as const }; },
  async me() { const db = load(); return db.loggedIn ? { username: "admin" } : null; },

  async status(): Promise<SystemStatus> {
    await wait();
    const db = load();
    return {
      uptimeSeconds: Math.floor((Date.now() - db.startedAt) / 1000),
      cpuPercent: 12 + Math.random() * 20,
      memoryPercent: 42, memoryUsedMb: 1680, memoryTotalMb: 4000,
      diskPercent: 33, diskUsedGb: 13.2, diskTotalGb: 40,
      netRxMbps: 2.4 + Math.random(), netTxMbps: 1.1 + Math.random(),
      services: [
        { name: "xray", running: true }, { name: "ssh", running: true },
        { name: "autoscript-ssh-ws", running: true }, { name: "nginx", running: true },
        { name: "autoscript-agent", running: true }, { name: "autoscript-bot", running: true },
      ],
      hostname: "vps-panel", os: "Ubuntu 22.04", kernel: "6.5.0", ipv4: "203.0.113.10",
    };
  },
  async traffic(range: "1h" | "24h" | "7d"): Promise<TrafficPoint[]> {
    const points = range === "1h" ? 60 : range === "24h" ? 24 : 84;
    const step = range === "1h" ? 60_000 : range === "24h" ? 3600_000 : 7200_000;
    const now = Date.now();
    return Array.from({ length: points }, (_, i) => {
      const hour = new Date(now - (points - i) * step).getHours();
      const factor = 0.4 + Math.sin((hour / 24) * Math.PI * 2) * 0.3 + Math.random() * 0.4;
      return {
        t: new Date(now - (points - i) * step).toISOString(),
        rxBytes: Math.floor(3_000_000_000 * factor),
        txBytes: Math.floor(1_500_000_000 * factor),
      };
    });
  },
  async version(): Promise<VersionInfo> {
    return { currentCommit: "a1b2c3d", currentDate: new Date(Date.now() - 3 * 86400_000).toISOString(),
             latestCommit: "e4f5g6h", latestDate: new Date().toISOString(), behind: 4, repo: "your-user/autoscript" };
  },
  async update() { await wait(800); return { ok: true as const, commit: "e4f5g6h" }; },

  async listAccounts(protocol?: Protocol) {
    const db = load();
    return protocol ? db.accounts.filter((a) => a.protocol === protocol) : db.accounts;
  },
  async getAccount(id: string) {
    const db = load();
    const a = db.accounts.find((x) => x.id === id);
    if (!a) throw new Error("Not found");
    return a;
  },
  async createAccount(input: Partial<Account>) {
    const db = load();
    const protocol = (input.protocol ?? "ssh") as Protocol;
    const a: Account = {
      id: `${protocol}-${Date.now()}`, protocol,
      username: input.username ?? "user",
      password: protocol === "ssh" ? input.password ?? "pass" : undefined,
      uuid: protocol !== "ssh" ? crypto.randomUUID() : undefined,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? new Date(Date.now() + 30 * 86400_000).toISOString(),
      ipLimit: input.ipLimit ?? 2,
      speedUpKbps: input.speedUpKbps ?? 0,
      speedDnKbps: input.speedDnKbps ?? 0,
      quotaGb: input.quotaGb ?? 0,
      usedBytes: 0, online: 0, status: "active",
      telegramId: input.telegramId, planId: input.planId, note: input.note,
    };
    db.accounts.unshift(a);
    db.logs.unshift({ id: "l" + Date.now(), ts: new Date().toISOString(), type: "audit", level: "info",
      actor: "admin", action: "account.create", target: a.username,
      message: `Created ${a.protocol} account ${a.username}` });
    save(db); return a;
  },
  async updateAccount(id: string, input: Partial<Account>) {
    const db = load();
    const a = db.accounts.find((x) => x.id === id);
    if (!a) throw new Error("Not found");
    Object.assign(a, input);
    db.logs.unshift({ id: "l" + Date.now(), ts: new Date().toISOString(), type: "audit", level: "info",
      actor: "admin", action: "account.update", target: a.username,
      message: `Updated ${a.protocol} account ${a.username}` });
    save(db); return a;
  },
  async removeAccount(id: string) {
    const db = load();
    const a = db.accounts.find((x) => x.id === id);
    db.accounts = db.accounts.filter((x) => x.id !== id);
    if (a) db.logs.unshift({ id: "l" + Date.now(), ts: new Date().toISOString(), type: "audit", level: "warn",
      actor: "admin", action: "account.delete", target: a.username,
      message: `Deleted ${a.protocol} account ${a.username}` });
    save(db); return { ok: true as const };
  },
  async accountConfig(id: string) {
    const db = load();
    const a = db.accounts.find((x) => x.id === id);
    if (!a) throw new Error("Not found");
    const host = db.settings.domain;
    if (a.protocol === "ssh") return {
      link: `ssh://${a.username}:${a.password}@${host}:22`,
      text: `Host: ${host}\nPort: 22 (SSH), 443 (WebSocket path /)\nUser: ${a.username}\nPassword: ${a.password}`,
    };
    if (a.protocol === "vmess") {
      const cfg = { v: "2", ps: a.username, add: host, port: 443, id: a.uuid, aid: 0, net: "ws", type: "none", host, path: "/vmess", tls: "tls" };
      return { link: "vmess://" + btoa(JSON.stringify(cfg)), text: JSON.stringify(cfg, null, 2) };
    }
    if (a.protocol === "vless") return { link: `vless://${a.uuid}@${host}:443?type=ws&security=tls&path=%2Fvless#${a.username}`, text: "" };
    return { link: `trojan://${a.uuid}@${host}:443?type=ws&security=tls&path=%2Ftrojan#${a.username}`, text: "" };
  },
  async logs(type?: "audit" | "service" | "auth") {
    const db = load();
    return type ? db.logs.filter((l) => l.type === type) : db.logs;
  },

  // Plans
  async listPlans() { return load().plans; },
  async savePlan(p: Partial<Plan>) {
    const db = load();
    if (p.id) {
      const existing = db.plans.find((x) => x.id === p.id);
      if (!existing) throw new Error("Not found");
      Object.assign(existing, p);
      save(db); return existing;
    }
    const created: Plan = {
      id: "plan-" + Date.now(),
      name: p.name ?? "Untitled",
      mode: p.mode ?? "prepaid",
      priceCents: p.priceCents ?? 0,
      durationDays: p.durationDays ?? 30,
      quotaGb: p.quotaGb ?? 0,
      speedUpKbps: p.speedUpKbps ?? 0,
      speedDnKbps: p.speedDnKbps ?? 0,
      ipLimit: p.ipLimit ?? 2,
      active: p.active ?? true,
    };
    db.plans.unshift(created); save(db); return created;
  },
  async removePlan(id: string) {
    const db = load(); db.plans = db.plans.filter((p) => p.id !== id); save(db);
    return { ok: true as const };
  },

  // Payments
  async listPayments(statusFilter?: Payment["status"]) {
    const db = load();
    return statusFilter ? db.payments.filter((p) => p.status === statusFilter) : db.payments;
  },
  async decidePayment(id: string, s: Payment["status"], reason?: string) {
    const db = load();
    const p = db.payments.find((x) => x.id === id);
    if (!p) throw new Error("Not found");
    p.status = s; if (reason) p.note = reason;
    db.logs.unshift({ id: "l" + Date.now(), ts: new Date().toISOString(), type: "audit", level: "info",
      actor: "admin", action: `payment.${s}`, target: p.telegramName,
      message: `${s === "approved" ? "Approved" : "Rejected"} payment ${p.id}` });
    save(db); return { ok: true as const };
  },

  // Bot
  async botGet() { return load().bot; },
  async botSave(s: Partial<BotSettings>) {
    const db = load(); Object.assign(db.bot, s); save(db); return db.bot;
  },
  async botRestart() { await wait(400); return { ok: true as const }; },

  // Settings
  async settingsGet() { return load().settings; },
  async settingsSave(s: Partial<PanelSettings>) {
    const db = load(); Object.assign(db.settings, s); save(db); return db.settings;
  },
};
