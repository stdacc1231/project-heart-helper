// Mock backend for Lovable preview. Real Python agent replaces this on the VPS.
import type {
  Account, Alert, Backup, BotSettings, Invoice, LiveConnection, LogEntry, Node,
  PanelSettings, Payment, Plan, Protocol, Reseller, SystemStatus, TrafficPoint,
  VersionInfo, WalletTx,
} from "./api";

const STORAGE = "autoscript_mock_v3";

interface MockDB {
  loggedIn: boolean;
  accounts: Account[];
  logs: LogEntry[];
  plans: Plan[];
  payments: Payment[];
  bot: BotSettings;
  settings: PanelSettings;
  startedAt: number;
  connections: LiveConnection[];
  nodes: Node[];
  backups: Backup[];
  alerts: Alert[];
  wallet: WalletTx[];
  walletBalanceCents: number;
  invoices: Invoice[];
  resellers: Reseller[];
}

function load(): MockDB {
  if (typeof window === "undefined") return seed();
  try { const raw = localStorage.getItem(STORAGE); if (raw) return JSON.parse(raw); } catch {}
  const db = seed();
  localStorage.setItem(STORAGE, JSON.stringify(db));
  return db;
}
function save(db: MockDB) {
  if (typeof window !== "undefined") localStorage.setItem(STORAGE, JSON.stringify(db));
}

const PROTOS: Protocol[] = ["ssh", "vmess", "vless", "trojan", "shadowsocks", "hysteria2", "tuic", "wireguard", "reality"];

function rnd<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }
function tok() { return Math.random().toString(36).slice(2, 12); }

function seed(): MockDB {
  const now = Date.now();
  const day = 86400_000;
  const plans: Plan[] = [
    { id: "p-basic", name: "Basic 30d", mode: "prepaid", priceCents: 300, durationDays: 30, quotaGb: 100, speedUpKbps: 5000, speedDnKbps: 5000, ipLimit: 2, active: true },
    { id: "p-pro",   name: "Pro 30d",   mode: "prepaid", priceCents: 700, durationDays: 30, quotaGb: 0,   speedUpKbps: 0,    speedDnKbps: 0,    ipLimit: 3, active: true },
    { id: "p-payg",  name: "PAYG /GB",  mode: "payg_gb", priceCents: 10,  durationDays: 0,  quotaGb: 0,   speedUpKbps: 0,    speedDnKbps: 0,    ipLimit: 2, active: true },
    { id: "p-trial", name: "1h Trial",  mode: "prepaid", priceCents: 0,   durationDays: 0,  quotaGb: 2,   speedUpKbps: 3000, speedDnKbps: 3000, ipLimit: 1, active: true },
  ];

  const accounts: Account[] = [];
  let i = 0;
  for (const protocol of PROTOS) {
    for (let k = 1; k <= 3; k++) {
      i++;
      accounts.push({
        id: `${protocol}-${i}`,
        protocol,
        username: `${protocol}${k}`,
        password: protocol === "ssh" ? "pass" + k : undefined,
        uuid: protocol !== "ssh" && protocol !== "wireguard" ? crypto.randomUUID() : undefined,
        createdAt: new Date(now - (30 - i) * day).toISOString(),
        expiresAt: new Date(now + (30 - i) * day).toISOString(),
        ipLimit: 2,
        speedUpKbps: i % 3 === 0 ? 0 : 5000,
        speedDnKbps: i % 3 === 0 ? 0 : 5000,
        quotaGb: i % 2 === 0 ? 0 : 100,
        usedBytes: Math.floor(Math.random() * 50 * 1024 ** 3),
        online: Math.random() > 0.5 ? Math.floor(Math.random() * 3) + 1 : 0,
        status: "active",
        telegramId: i % 2 ? String(500000000 + i * 137) : undefined,
        planId: plans[i % plans.length].id,
        cdn: protocol === "vmess" || protocol === "vless",
        subscriptionToken: tok(),
        trial: false,
        nodeId: i % 3 === 0 ? "node-eu" : "node-sg",
      });
    }
  }

  const countries = ["US", "DE", "SG", "JP", "ID", "BR", "GB", "FR", "AE", "IN"];
  const connections: LiveConnection[] = accounts
    .filter((a) => a.online > 0)
    .flatMap((a) =>
      Array.from({ length: a.online }, (_, j) => ({
        id: `c-${a.id}-${j}`,
        accountId: a.id,
        username: a.username,
        protocol: a.protocol,
        ip: `${1 + Math.floor(Math.random() * 254)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
        country: rnd(countries),
        city: rnd(["Frankfurt", "Tokyo", "Singapore", "Dallas", "Jakarta", "London"]),
        device: rnd(["Android", "iPhone", "Windows", "macOS", "Linux"]),
        connectedAt: new Date(now - Math.floor(Math.random() * 3600_000)).toISOString(),
        rxBytes: Math.floor(Math.random() * 200 * 1024 ** 2),
        txBytes: Math.floor(Math.random() * 40 * 1024 ** 2),
      })),
    );

  const nodes: Node[] = [
    { id: "node-sg", label: "Singapore", host: "sg1.example.com", region: "SG", status: "online", users: 34, cpu: 22, memory: 47, bandwidthMbps: 320, version: "1.0.3", lastSeen: new Date(now).toISOString() },
    { id: "node-eu", label: "Frankfurt", host: "de1.example.com", region: "EU", status: "online", users: 21, cpu: 15, memory: 39, bandwidthMbps: 210, version: "1.0.3", lastSeen: new Date(now - 40_000).toISOString() },
    { id: "node-us", label: "Dallas",    host: "us1.example.com", region: "US", status: "degraded", users: 12, cpu: 65, memory: 71, bandwidthMbps: 88, version: "1.0.2", lastSeen: new Date(now - 15 * 60_000).toISOString() },
  ];

  const backups: Backup[] = [
    { id: "bk-1", createdAt: new Date(now - day).toISOString(),     sizeBytes: 4_600_000, kind: "scheduled", destination: "telegram", status: "ready" },
    { id: "bk-2", createdAt: new Date(now - 3 * day).toISOString(), sizeBytes: 4_400_000, kind: "scheduled", destination: "s3",       status: "ready" },
    { id: "bk-3", createdAt: new Date(now - 7 * day).toISOString(), sizeBytes: 4_200_000, kind: "manual",    destination: "local",    status: "ready" },
  ];

  const alerts: Alert[] = [
    { id: "a-1", ts: new Date(now - 600_000).toISOString(),  level: "warn",     source: "cert", message: "Panel TLS certificate expires in 6 days.", acknowledged: false },
    { id: "a-2", ts: new Date(now - 3_600_000).toISOString(),level: "info",     source: "login",message: "Successful admin login from 203.0.113.10.", acknowledged: true },
    { id: "a-3", ts: new Date(now - 7_200_000).toISOString(),level: "critical", source: "xray",message: "xray restarted 3× in last hour.",           acknowledged: false },
  ];

  const invoices: Invoice[] = [
    { id: "inv-1", number: "INV-2026-0001", telegramId: "500000123", username: "sshuser1", planName: "Basic 30d", amountCents: 300, method: "manual", issuedAt: new Date(now - 3 * day).toISOString(), paidAt: new Date(now - 3 * day).toISOString(), pdfUrl: "#" },
    { id: "inv-2", number: "INV-2026-0002", telegramId: "500000999", username: "vmess2",   planName: "Pro 30d",   amountCents: 700, method: "crypto_usdt", issuedAt: new Date(now - day).toISOString(), paidAt: new Date(now - day).toISOString(), pdfUrl: "#" },
  ];

  const wallet: WalletTx[] = [
    { id: "w-1", ts: new Date(now - 2 * day).toISOString(), amountCents:  1000, reason: "Reseller top-up",   balanceAfterCents: 1000 },
    { id: "w-2", ts: new Date(now -     day).toISOString(), amountCents:  -300, reason: "Basic 30d purchase",balanceAfterCents:  700, telegramId: "500000123" },
    { id: "w-3", ts: new Date(now - 3_600_000).toISOString(),amountCents:   500, reason: "Refund adjustment", balanceAfterCents: 1200 },
  ];

  const resellers: Reseller[] = [
    { id: "r-1", name: "Alice",   telegramId: "500000123", balanceCents: 4500, quotaUsers: 50, usersCreated: 12, active: true,  createdAt: new Date(now - 20 * day).toISOString() },
    { id: "r-2", name: "Rendi",   telegramId: "500000777", balanceCents:  900, quotaUsers: 20, usersCreated:  4, active: true,  createdAt: new Date(now - 10 * day).toISOString() },
    { id: "r-3", name: "Kenji",   telegramId: "500000456", balanceCents:    0, quotaUsers: 30, usersCreated: 30, active: false, createdAt: new Date(now - 60 * day).toISOString() },
  ];

  const payments: Payment[] = [
    { id: "pay-1", telegramId: "500000123", telegramName: "@alice", planId: "p-basic", planName: "Basic 30d", amountCents: 300, method: "bank",        proofUrl: "https://placehold.co/400x600/0d1220/78e2c4?text=Bank+Slip",  createdAt: new Date(now - 3600_000).toISOString(), status: "pending" },
    { id: "pay-2", telegramId: "500000999", telegramName: "@bob",   planId: "p-pro",   planName: "Pro 30d",   amountCents: 700, method: "crypto_usdt", proofUrl: "https://placehold.co/400x600/0d1220/bda0ff?text=USDT+TxID", createdAt: new Date(now - 7200_000).toISOString(), status: "pending" },
    { id: "pay-3", telegramId: "500000555", telegramName: "@carol", planId: "p-basic", planName: "Basic 30d", amountCents: 300, method: "stripe",      proofUrl: "https://placehold.co/400x600/0d1220/9adfff?text=Stripe",    createdAt: new Date(now - 86400_000).toISOString(), status: "approved" },
  ];

  const logs: LogEntry[] = accounts.slice(0, 8).map((a, k) => ({
    id: "l" + k,
    ts: new Date(now - k * 3600_000).toISOString(),
    type: k % 3 === 0 ? "auth" : "audit",
    level: "info", actor: "admin",
    action: k % 2 ? "account.create" : "account.update",
    target: a.username,
    message: `${k % 2 ? "Created" : "Updated"} ${a.protocol} account ${a.username}`,
  }));

  const bot: BotSettings = {
    enabled: true, token: "", adminChatId: "",
    welcomeText: "Welcome! Tap a plan below to purchase.",
    autoDeleteMinutes: 10,
    paymentInstructions: "Bank BCA 1234567890 a/n Autoscript · USDT-TRC20 TXxxxxx · after payment upload proof here.",
    running: true,
  };

  const settings: PanelSettings = {
    domain: "panel.example.com", port: 443, tlsMode: "single",
    dnsProvider: "dns_cf", rootDomain: "example.com",
    dbPath: "/etc/autoscript/db.sqlite", repoUrl: "https://github.com/your-user/autoscript.git",
    cdn: { enabled: true, provider: "cloudflare", realIpHeader: "CF-Connecting-IP" },
    bbr: true,
  };

  return {
    loggedIn: false, accounts, logs, plans, payments, bot, settings,
    startedAt: now - 3 * day, connections, nodes, backups, alerts,
    wallet, walletBalanceCents: 1200, invoices, resellers,
  };
}

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const audit = (db: MockDB, action: string, message: string, target?: string) =>
  db.logs.unshift({ id: "l" + Date.now() + Math.random(), ts: new Date().toISOString(),
    type: "audit", level: "info", actor: "admin", action, target, message });

export const mock = {
  async login(u: string, p: string) { await wait(); if (!u || !p) throw new Error("Invalid credentials"); const db = load(); db.loggedIn = true; save(db); return { ok: true as const }; },
  async logout() { const db = load(); db.loggedIn = false; save(db); return { ok: true as const }; },
  async me() { const db = load(); return db.loggedIn ? { username: "admin" } : null; },

  async status(): Promise<SystemStatus> {
    await wait(); const db = load();
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
        { name: "fail2ban", running: true }, { name: "acme-renew", running: true },
      ],
      hostname: "vps-panel", os: "Ubuntu 22.04 LTS", kernel: "6.5.0", ipv4: "203.0.113.10",
      loadAvg: [0.42, 0.51, 0.61],
    };
  },
  async traffic(range: "1h" | "24h" | "7d"): Promise<TrafficPoint[]> {
    const points = range === "1h" ? 60 : range === "24h" ? 24 : 84;
    const step = range === "1h" ? 60_000 : range === "24h" ? 3600_000 : 7200_000;
    const now = Date.now();
    return Array.from({ length: points }, (_, i) => {
      const hour = new Date(now - (points - i) * step).getHours();
      const factor = 0.4 + Math.sin((hour / 24) * Math.PI * 2) * 0.3 + Math.random() * 0.4;
      return { t: new Date(now - (points - i) * step).toISOString(),
        rxBytes: Math.floor(3_000_000_000 * factor), txBytes: Math.floor(1_500_000_000 * factor) };
    });
  },
  async version(): Promise<VersionInfo> {
    return { currentCommit: "a1b2c3d", currentDate: new Date(Date.now() - 3 * 86400_000).toISOString(),
             latestCommit: "e4f5g6h", latestDate: new Date().toISOString(), behind: 4, repo: "your-user/autoscript" };
  },
  async update() { await wait(800); return { ok: true as const, commit: "e4f5g6h" }; },
  async restartService(name: string) { await wait(400); const db = load(); audit(db, "service.restart", `Restarted ${name}`, name); save(db); return { ok: true as const }; },
  async speedtest() { await wait(1200); return { downMbps: 480 + Math.random() * 100, upMbps: 250 + Math.random() * 60, pingMs: 8 + Math.random() * 4 }; },
  async toggleBbr(on: boolean) { const db = load(); db.settings.bbr = on; save(db); return { ok: true as const }; },

  async listAccounts(protocol?: Protocol) {
    const db = load(); return protocol ? db.accounts.filter((a) => a.protocol === protocol) : db.accounts;
  },
  async getAccount(id: string) { const db = load(); const a = db.accounts.find((x) => x.id === id); if (!a) throw new Error("Not found"); return a; },
  async createAccount(input: Partial<Account>) {
    const db = load();
    const protocol = (input.protocol ?? "ssh") as Protocol;
    const trial = !!input.trial;
    const a: Account = {
      id: `${protocol}-${Date.now()}`, protocol,
      username: input.username ?? "user",
      password: (protocol === "ssh" || protocol === "shadowsocks") ? (input.password ?? "pass") : undefined,
      uuid: (protocol !== "ssh" && protocol !== "wireguard" && protocol !== "shadowsocks") ? crypto.randomUUID() : undefined,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? new Date(Date.now() + (trial ? 3600_000 : 30 * 86400_000)).toISOString(),
      ipLimit: input.ipLimit ?? 2,
      speedUpKbps: input.speedUpKbps ?? 0, speedDnKbps: input.speedDnKbps ?? 0,
      quotaGb: input.quotaGb ?? 0, usedBytes: 0, online: 0,
      status: trial ? "trial" : "active",
      telegramId: input.telegramId, planId: input.planId, note: input.note,
      cdn: input.cdn ?? false, subscriptionToken: tok(), trial,
      nodeId: input.nodeId ?? "node-sg",
    };
    db.accounts.unshift(a);
    audit(db, "account.create", `Created ${a.protocol} account ${a.username}${trial ? " (trial)" : ""}`, a.username);
    save(db); return a;
  },
  async updateAccount(id: string, input: Partial<Account>) {
    const db = load(); const a = db.accounts.find((x) => x.id === id); if (!a) throw new Error("Not found");
    Object.assign(a, input); audit(db, "account.update", `Updated ${a.protocol} ${a.username}`, a.username);
    save(db); return a;
  },
  async removeAccount(id: string) {
    const db = load(); const a = db.accounts.find((x) => x.id === id);
    db.accounts = db.accounts.filter((x) => x.id !== id);
    db.connections = db.connections.filter((c) => c.accountId !== id);
    if (a) audit(db, "account.delete", `Deleted ${a.protocol} ${a.username}`, a.username);
    save(db); return { ok: true as const };
  },
  async bulkAccounts(action: "extend" | "delete" | "lock" | "unlock", ids: string[], days = 30) {
    const db = load();
    for (const id of ids) {
      const a = db.accounts.find((x) => x.id === id); if (!a) continue;
      if (action === "delete") { db.accounts = db.accounts.filter((x) => x.id !== id); }
      else if (action === "extend") { a.expiresAt = new Date(Date.parse(a.expiresAt) + days * 86400_000).toISOString(); }
      else if (action === "lock") a.status = "locked";
      else if (action === "unlock") a.status = "active";
    }
    audit(db, `account.bulk.${action}`, `${action} ${ids.length} account(s)`);
    save(db); return { ok: true as const, count: ids.length };
  },
  async accountConfig(id: string) {
    const db = load(); const a = db.accounts.find((x) => x.id === id); if (!a) throw new Error("Not found");
    const host = db.settings.domain;
    if (a.protocol === "ssh") return { link: `ssh://${a.username}:${a.password}@${host}:22`,
      text: `Host: ${host}\nSSH port: 22\nWebSocket: wss://${host}:443/  (path "/", HTTP/1.1)\nUser: ${a.username}\nPassword: ${a.password}` };
    if (a.protocol === "vmess") {
      const cfg = { v: "2", ps: a.username, add: host, port: 443, id: a.uuid, aid: 0, net: "ws", type: "none", host, path: "/vmess", tls: "tls" };
      return { link: "vmess://" + btoa(JSON.stringify(cfg)), text: JSON.stringify(cfg, null, 2) };
    }
    if (a.protocol === "vless")   return { link: `vless://${a.uuid}@${host}:443?type=ws&security=tls&path=%2Fvless#${a.username}`, text: "" };
    if (a.protocol === "trojan")  return { link: `trojan://${a.uuid}@${host}:443?type=ws&security=tls&path=%2Ftrojan#${a.username}`, text: "" };
    if (a.protocol === "reality") return { link: `vless://${a.uuid}@${host}:443?security=reality&sni=www.microsoft.com&pbk=REALITY_PBK&fp=chrome#${a.username}`, text: "VLESS-Reality" };
    if (a.protocol === "shadowsocks") return { link: `ss://${btoa("aes-256-gcm:" + a.password)}@${host}:8388#${a.username}`, text: "" };
    if (a.protocol === "hysteria2") return { link: `hysteria2://${a.password ?? a.uuid}@${host}:36712?sni=${host}#${a.username}`, text: "" };
    if (a.protocol === "tuic")      return { link: `tuic://${a.uuid}:${a.password ?? "pw"}@${host}:5443?alpn=h3&sni=${host}#${a.username}`, text: "" };
    return { link: `# WireGuard config for ${a.username} — download from panel`, text: `[Interface]\nPrivateKey = ...\nAddress = 10.7.0.${(parseInt(a.id.slice(-1), 16) || 2)}/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = SERVER_PUB\nEndpoint = ${host}:51820\nAllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25\n` };
  },
  async subscriptionUrl(id: string) {
    const db = load(); const a = db.accounts.find((x) => x.id === id); if (!a) throw new Error("Not found");
    return { url: `https://${db.settings.domain}/sub/${a.subscriptionToken}` };
  },
  async importCsv(csv: string) {
    const db = load();
    const lines = csv.trim().split("\n").slice(1);
    let created = 0;
    for (const l of lines) {
      const [protocol, username, password, expiresAt] = l.split(",");
      if (!protocol || !username) continue;
      db.accounts.unshift({
        id: `${protocol}-${Date.now()}-${created}`, protocol: protocol as Protocol,
        username, password: password || undefined, uuid: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        expiresAt: (expiresAt && new Date(expiresAt).toISOString()) || new Date(Date.now() + 30 * 86400_000).toISOString(),
        ipLimit: 2, speedUpKbps: 0, speedDnKbps: 0, quotaGb: 0, usedBytes: 0, online: 0, status: "active",
        subscriptionToken: tok(),
      });
      created++;
    }
    audit(db, "account.import", `Imported ${created} accounts from CSV`);
    save(db); return { created };
  },
  async exportCsv() {
    const db = load();
    const rows = [["protocol", "username", "password", "expiresAt", "quotaGb", "usedBytes"].join(",")];
    for (const a of db.accounts) rows.push([a.protocol, a.username, a.password ?? "", a.expiresAt, a.quotaGb, a.usedBytes].join(","));
    return { csv: rows.join("\n") };
  },
  async sendTelegram(id: string) { await wait(400); const db = load(); const a = db.accounts.find((x) => x.id === id); audit(db, "telegram.send", `Sent config to ${a?.telegramId ?? "?"}`, a?.username); save(db); return { ok: true as const }; },

  async listConnections() { return load().connections; },
  async kickConnection(id: string) { const db = load(); const c = db.connections.find((x) => x.id === id); db.connections = db.connections.filter((x) => x.id !== id); if (c) audit(db, "connection.kick", `Kicked ${c.username} (${c.ip})`, c.username); save(db); return { ok: true as const }; },

  async listNodes() { return load().nodes; },
  async addNode(n: Partial<Node>) { const db = load(); const node: Node = { id: "node-" + Date.now(), label: n.label ?? "Node", host: n.host ?? "", region: n.region ?? "??", status: "online", users: 0, cpu: 0, memory: 0, bandwidthMbps: 0, version: "1.0.3", lastSeen: new Date().toISOString() }; db.nodes.unshift(node); audit(db, "node.add", `Added node ${node.label}`); save(db); return node; },
  async removeNode(id: string) { const db = load(); const n = db.nodes.find((x) => x.id === id); db.nodes = db.nodes.filter((x) => x.id !== id); if (n) audit(db, "node.remove", `Removed node ${n.label}`); save(db); return { ok: true as const }; },

  async listBackups() { return load().backups; },
  async createBackup(destination: Backup["destination"]) { await wait(600); const db = load(); const b: Backup = { id: "bk-" + Date.now(), createdAt: new Date().toISOString(), sizeBytes: 4_500_000 + Math.floor(Math.random() * 300_000), kind: "manual", destination, status: "ready" }; db.backups.unshift(b); audit(db, "backup.create", `Created ${destination} backup`); save(db); return b; },
  async restoreBackup(id: string) { await wait(1200); const db = load(); audit(db, "backup.restore", `Restored backup ${id}`); save(db); return { ok: true as const }; },
  async removeBackup(id: string) { const db = load(); db.backups = db.backups.filter((b) => b.id !== id); save(db); return { ok: true as const }; },

  async listAlerts() { return load().alerts; },
  async ackAlert(id: string) { const db = load(); const a = db.alerts.find((x) => x.id === id); if (a) a.acknowledged = true; save(db); return { ok: true as const }; },

  async listWallet() { return load().wallet; },
  async walletBalance() { return { balanceCents: load().walletBalanceCents }; },
  async creditWallet(amountCents: number, reason: string) {
    const db = load(); db.walletBalanceCents += amountCents;
    db.wallet.unshift({ id: "w-" + Date.now(), ts: new Date().toISOString(), amountCents, reason, balanceAfterCents: db.walletBalanceCents });
    audit(db, "wallet.credit", `${amountCents > 0 ? "+" : ""}${amountCents}¢ ${reason}`);
    save(db); return { ok: true as const };
  },

  async listInvoices() { return load().invoices; },
  async sendInvoice(id: string, via: "email" | "telegram") { await wait(400); const db = load(); const inv = db.invoices.find((x) => x.id === id); audit(db, "invoice.send", `Sent invoice ${inv?.number} via ${via}`); save(db); return { ok: true as const }; },


  // Plans, payments, bot, settings, logs
  async listPlans() { return load().plans; },
  async savePlan(p: Partial<Plan>) {
    const db = load();
    if (p.id) { const ex = db.plans.find((x) => x.id === p.id); if (!ex) throw new Error("Not found"); Object.assign(ex, p); save(db); return ex; }
    const created: Plan = { id: "plan-" + Date.now(), name: p.name ?? "Untitled", mode: p.mode ?? "prepaid", priceCents: p.priceCents ?? 0, durationDays: p.durationDays ?? 30, quotaGb: p.quotaGb ?? 0, speedUpKbps: p.speedUpKbps ?? 0, speedDnKbps: p.speedDnKbps ?? 0, ipLimit: p.ipLimit ?? 2, active: p.active ?? true };
    db.plans.unshift(created); save(db); return created;
  },
  async removePlan(id: string) { const db = load(); db.plans = db.plans.filter((p) => p.id !== id); save(db); return { ok: true as const }; },

  async listPayments(s?: Payment["status"]) { const db = load(); return s ? db.payments.filter((p) => p.status === s) : db.payments; },
  async decidePayment(id: string, s: Payment["status"], reason?: string) {
    const db = load(); const p = db.payments.find((x) => x.id === id); if (!p) throw new Error("Not found");
    p.status = s; if (reason) p.note = reason;
    audit(db, `payment.${s}`, `${s === "approved" ? "Approved" : "Rejected"} payment ${p.id}`, p.telegramName);
    save(db); return { ok: true as const };
  },

  async botGet() { return load().bot; },
  async botSave(s: Partial<BotSettings>) { const db = load(); Object.assign(db.bot, s); save(db); return db.bot; },
  async botRestart() { await wait(400); return { ok: true as const }; },

  async settingsGet() { return load().settings; },
  async settingsSave(s: Partial<PanelSettings>) { const db = load(); Object.assign(db.settings, s); save(db); return db.settings; },

  async logs(type?: "audit" | "service" | "auth") { const db = load(); return type ? db.logs.filter((l) => l.type === type) : db.logs; },
};
