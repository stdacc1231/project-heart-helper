// Mock backend for Lovable preview. On the VPS the real Python agent replaces this.
import type { Account, LogEntry, Protocol, SystemStatus, TrafficPoint, VersionInfo } from "./api";

const STORAGE = "autoscript_mock_v1";

interface MockDB {
  loggedIn: boolean;
  accounts: Account[];
  logs: LogEntry[];
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
  const mk = (i: number, protocol: Protocol): Account => ({
    id: `${protocol}-${i}`,
    protocol,
    username: `${protocol}user${i}`,
    password: protocol === "ssh" ? "pass" + i : undefined,
    uuid: protocol !== "ssh" ? crypto.randomUUID() : undefined,
    createdAt: new Date(now - (10 - i) * day).toISOString(),
    expiresAt: new Date(now + (30 - i) * day).toISOString(),
    ipLimit: 2,
    speedLimitKbps: i % 3 === 0 ? 0 : 5000,
    quotaGb: i % 2 === 0 ? 0 : 100,
    usedBytes: Math.floor(Math.random() * 50 * 1024 ** 3),
    online: Math.random() > 0.6 ? Math.floor(Math.random() * 3) + 1 : 0,
    status: "active",
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
  return { loggedIn: false, accounts, logs, startedAt: now - 3 * day };
}

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export const mock = {
  async login(username: string, password: string) {
    await wait();
    if (!username || !password) throw new Error("Invalid credentials");
    const db = load();
    db.loggedIn = true;
    save(db);
    return { ok: true as const };
  },
  async logout() {
    const db = load();
    db.loggedIn = false;
    save(db);
    return { ok: true as const };
  },
  async me() {
    const db = load();
    return db.loggedIn ? { username: "admin" } : null;
  },
  async status(): Promise<SystemStatus> {
    await wait();
    const db = load();
    return {
      uptimeSeconds: Math.floor((Date.now() - db.startedAt) / 1000),
      cpuPercent: 12 + Math.random() * 20,
      memoryPercent: 42,
      memoryUsedMb: 1680,
      memoryTotalMb: 4000,
      diskPercent: 33,
      diskUsedGb: 13.2,
      diskTotalGb: 40,
      netRxMbps: 2.4 + Math.random(),
      netTxMbps: 1.1 + Math.random(),
      services: [
        { name: "xray", running: true },
        { name: "ssh", running: true },
        { name: "ssh-ws", running: true },
        { name: "nginx", running: true },
        { name: "autoscript-agent", running: true },
      ],
      hostname: "vps-panel",
      os: "Ubuntu 22.04",
      kernel: "6.5.0",
      ipv4: "203.0.113.10",
    };
  },
  async traffic(range: "1h" | "24h" | "7d"): Promise<TrafficPoint[]> {
    const points = range === "1h" ? 60 : range === "24h" ? 48 : 84;
    const step = range === "1h" ? 60_000 : range === "24h" ? 1800_000 : 7200_000;
    const now = Date.now();
    return Array.from({ length: points }, (_, i) => ({
      t: new Date(now - (points - i) * step).toISOString(),
      rxBytes: Math.floor(1_000_000 + Math.random() * 8_000_000),
      txBytes: Math.floor(500_000 + Math.random() * 4_000_000),
    }));
  },
  async version(): Promise<VersionInfo> {
    return {
      currentCommit: "a1b2c3d",
      currentDate: new Date(Date.now() - 3 * 86400_000).toISOString(),
      latestCommit: "e4f5g6h",
      latestDate: new Date().toISOString(),
      behind: 4,
      repo: "your-user/autoscript",
    };
  },
  async update() {
    await wait(800);
    return { ok: true as const, commit: "e4f5g6h" };
  },
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
      id: `${protocol}-${Date.now()}`,
      protocol,
      username: input.username ?? "user",
      password: protocol === "ssh" ? input.password ?? "pass" : undefined,
      uuid: protocol !== "ssh" ? crypto.randomUUID() : undefined,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? new Date(Date.now() + 30 * 86400_000).toISOString(),
      ipLimit: input.ipLimit ?? 2,
      speedLimitKbps: input.speedLimitKbps ?? 0,
      quotaGb: input.quotaGb ?? 0,
      usedBytes: 0,
      online: 0,
      status: "active",
    };
    db.accounts.unshift(a);
    db.logs.unshift({
      id: "l" + Date.now(),
      ts: new Date().toISOString(),
      type: "audit",
      level: "info",
      actor: "admin",
      action: "account.create",
      target: a.username,
      message: `Created ${a.protocol} account ${a.username}`,
    });
    save(db);
    return a;
  },
  async updateAccount(id: string, input: Partial<Account>) {
    const db = load();
    const a = db.accounts.find((x) => x.id === id);
    if (!a) throw new Error("Not found");
    Object.assign(a, input);
    db.logs.unshift({
      id: "l" + Date.now(),
      ts: new Date().toISOString(),
      type: "audit",
      level: "info",
      actor: "admin",
      action: "account.update",
      target: a.username,
      message: `Updated ${a.protocol} account ${a.username}`,
    });
    save(db);
    return a;
  },
  async removeAccount(id: string) {
    const db = load();
    const a = db.accounts.find((x) => x.id === id);
    db.accounts = db.accounts.filter((x) => x.id !== id);
    if (a) {
      db.logs.unshift({
        id: "l" + Date.now(),
        ts: new Date().toISOString(),
        type: "audit",
        level: "warn",
        actor: "admin",
        action: "account.delete",
        target: a.username,
        message: `Deleted ${a.protocol} account ${a.username}`,
      });
    }
    save(db);
    return { ok: true as const };
  },
  async accountConfig(id: string) {
    const db = load();
    const a = db.accounts.find((x) => x.id === id);
    if (!a) throw new Error("Not found");
    const host = "panel.example.com";
    if (a.protocol === "ssh") {
      return {
        link: `ssh://${a.username}:${a.password}@${host}:22`,
        text: `Host: ${host}\nPort: 22 (SSH), 80 (WebSocket path /)\nUser: ${a.username}\nPassword: ${a.password}`,
      };
    }
    if (a.protocol === "vmess") {
      const cfg = { v: "2", ps: a.username, add: host, port: 443, id: a.uuid, aid: 0, net: "ws", type: "none", host, path: "/vmess", tls: "tls" };
      return { link: "vmess://" + btoa(JSON.stringify(cfg)), text: JSON.stringify(cfg, null, 2) };
    }
    if (a.protocol === "vless") {
      return { link: `vless://${a.uuid}@${host}:443?type=ws&security=tls&path=%2Fvless#${a.username}`, text: "" };
    }
    return { link: `trojan://${a.uuid}@${host}:443?type=ws&security=tls&path=%2Ftrojan#${a.username}`, text: "" };
  },
  async logs(type?: "audit" | "service" | "auth") {
    const db = load();
    return type ? db.logs.filter((l) => l.type === type) : db.logs;
  },
};
