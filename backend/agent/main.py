"""
Autoscript Panel — FastAPI agent.

Runs on the VPS behind Nginx.  The web UI talks to /api/*.  The Telegram bot
runs as a sibling service and talks to /bot/* on the internal port with a
shared X-Internal-Token header so business rules stay in one place.
"""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import time
import uuid as _uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import quote

import psutil
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.hash import argon2
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PANEL_DOMAIN   = os.environ.get("PANEL_DOMAIN", "panel.local")
PANEL_PORT     = int(os.environ.get("PANEL_PORT", "443"))
DB_PATH        = os.environ.get("DB_PATH", "/etc/autoscript/db.sqlite")
JWT_SECRET     = os.environ.get("JWT_SECRET", "dev-secret-change-me")
ADMIN_USER     = os.environ.get("ADMIN_USER", "admin")
ADMIN_HASH     = os.environ.get("ADMIN_HASH", "").strip().strip("'\"")
REPO_URL       = os.environ.get("REPO_URL", "")
INSTALL_ROOT   = os.environ.get("INSTALL_ROOT", "/opt/autoscript")
INTERNAL_TOKEN = os.environ.get("BOT_INTERNAL_TOKEN", "")
UPLOAD_DIR     = Path(os.environ.get("UPLOAD_DIR", "/etc/autoscript/uploads"))
SCRIPTS        = Path(INSTALL_ROOT) / "backend" / "scripts"
PANEL_PATH     = (os.environ.get("PANEL_PATH", "") or "").strip("/")
GATE_SECRET    = os.environ.get("GATE_SECRET", "gate-dev-change-me")

JWT_ALG = "HS256"
JWT_TTL = 60 * 60 * 24

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY,
    protocol      TEXT NOT NULL CHECK(protocol IN ('ssh','vmess','vless','trojan')),
    username      TEXT NOT NULL UNIQUE,
    password      TEXT,
    uuid          TEXT,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    ip_limit      INTEGER NOT NULL DEFAULT 2,
    speed_up_kbps INTEGER NOT NULL DEFAULT 0,
    speed_dn_kbps INTEGER NOT NULL DEFAULT 0,
    quota_gb      INTEGER NOT NULL DEFAULT 0,
    used_bytes    INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'active',
    telegram_id   TEXT,
    plan_id       TEXT,
    note          TEXT
);
CREATE TABLE IF NOT EXISTS logs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      TEXT NOT NULL,
    type    TEXT NOT NULL,
    level   TEXT NOT NULL,
    actor   TEXT,
    action  TEXT NOT NULL,
    target  TEXT,
    message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('prepaid','payg_gb','payg_day')),
    price_cents INTEGER NOT NULL DEFAULT 0,
    duration_days INTEGER NOT NULL DEFAULT 0,
    quota_gb INTEGER NOT NULL DEFAULT 0,
    speed_up_kbps INTEGER NOT NULL DEFAULT 0,
    speed_dn_kbps INTEGER NOT NULL DEFAULT 0,
    ip_limit INTEGER NOT NULL DEFAULT 2,
    active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    telegram_id TEXT NOT NULL,
    telegram_name TEXT,
    plan_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    proof_path TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS traffic_samples (
    ts TEXT NOT NULL,
    rx_bytes INTEGER NOT NULL,
    tx_bytes INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traffic_ts ON traffic_samples(ts);
CREATE TABLE IF NOT EXISTS account_traffic (
    account_id TEXT NOT NULL,
    day TEXT NOT NULL,
    rx_bytes INTEGER NOT NULL DEFAULT 0,
    tx_bytes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, day)
);
CREATE INDEX IF NOT EXISTS idx_account_traffic_day ON account_traffic(day);
"""



ACCOUNT_COLUMNS = {
    "protocol":      "TEXT NOT NULL DEFAULT 'ssh'",
    "username":      "TEXT NOT NULL DEFAULT ''",
    "password":      "TEXT",
    "uuid":          "TEXT",
    "created_at":    "TEXT NOT NULL DEFAULT ''",
    "expires_at":    "TEXT NOT NULL DEFAULT ''",
    "ip_limit":      "INTEGER NOT NULL DEFAULT 2",
    "speed_up_kbps": "INTEGER NOT NULL DEFAULT 0",
    "speed_dn_kbps": "INTEGER NOT NULL DEFAULT 0",
    "quota_gb":      "INTEGER NOT NULL DEFAULT 0",
    "used_bytes":    "INTEGER NOT NULL DEFAULT 0",
    "status":        "TEXT NOT NULL DEFAULT 'active'",
    "telegram_id":   "TEXT",
    "plan_id":       "TEXT",
    "note":          "TEXT",
}

PLAN_COLUMNS = {
    "name": "TEXT NOT NULL DEFAULT ''",
    "mode": "TEXT NOT NULL DEFAULT 'prepaid'",
    "price_cents": "INTEGER NOT NULL DEFAULT 0",
    "duration_days": "INTEGER NOT NULL DEFAULT 0",
    "quota_gb": "INTEGER NOT NULL DEFAULT 0",
    "speed_up_kbps": "INTEGER NOT NULL DEFAULT 0",
    "speed_dn_kbps": "INTEGER NOT NULL DEFAULT 0",
    "ip_limit": "INTEGER NOT NULL DEFAULT 2",
    "active": "INTEGER NOT NULL DEFAULT 1",
}


def _migrate(con: sqlite3.Connection) -> None:
    """Backfill columns added after the first install so old DBs keep working."""
    have = {row["name"] for row in con.execute("PRAGMA table_info(accounts)").fetchall()}
    if have:
        for col, decl in ACCOUNT_COLUMNS.items():
            if col not in have:
                try:
                    con.execute(f"ALTER TABLE accounts ADD COLUMN {col} {decl}")
                except sqlite3.OperationalError as exc:
                    print(f"schema-migrate-skip accounts.{col}: {exc}", flush=True)
    have = {row["name"] for row in con.execute("PRAGMA table_info(plans)").fetchall()}
    if have:
        for col, decl in PLAN_COLUMNS.items():
            if col not in have:
                try:
                    con.execute(f"ALTER TABLE plans ADD COLUMN {col} {decl}")
                except sqlite3.OperationalError as exc:
                    print(f"schema-migrate-skip plans.{col}: {exc}", flush=True)


@contextmanager
def db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        con.executescript(SCHEMA)
        _migrate(con)
        yield con
        con.commit()
    finally:
        con.close()



def kv_get(key: str, default: str = "") -> str:
    with db() as c:
        r = c.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return r["value"] if r else default


def kv_set(key: str, value: str) -> None:
    with db() as c:
        c.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  (key, value))


def log(kind: str, action: str, message: str, *, actor="system", target=None, level="info"):
    try:
        with db() as c:
            c.execute("INSERT INTO logs(ts,type,level,actor,action,target,message) VALUES(?,?,?,?,?,?,?)",
                      (datetime.now(timezone.utc).isoformat(), kind, level, actor, action, target, message))
    except Exception as exc:
        # Audit logging must never break auth or panel actions.  If the DB is
        # temporarily read-only/missing, keep the request alive and leave a
        # journal entry for troubleshooting/fail2ban visibility.
        print(f"audit-log-failed action={action} error={exc}", flush=True)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
bearer = HTTPBearer(auto_error=False)


def make_token(sub: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": sub, "iat": now, "exp": now + timedelta(seconds=JWT_TTL)},
                      JWT_SECRET, algorithm=JWT_ALG)


def require_auth(request: Request, creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> str:
    token = creds.credentials if creds else request.cookies.get("token")
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing token")
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])["sub"]
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bad token")


def require_internal(x_internal_token: str = Header(default="")) -> None:
    if not INTERNAL_TOKEN or x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginIn(BaseModel):
    username: str
    password: str


class AccountIn(BaseModel):
    protocol: str
    username: str
    password: Optional[str] = None
    expiresAt: str
    ipLimit: int = 2
    speedUpKbps: int = 0
    speedDnKbps: int = 0
    quotaGb: int = 0
    telegramId: Optional[str] = None
    planId: Optional[str] = None
    trial: Optional[bool] = None


class AccountPatch(BaseModel):
    password: Optional[str] = None
    expiresAt: Optional[str] = None
    ipLimit: Optional[int] = None
    speedUpKbps: Optional[int] = None
    speedDnKbps: Optional[int] = None
    quotaGb: Optional[int] = None
    telegramId: Optional[str] = None


class PlanIn(BaseModel):
    name: str
    mode: str
    priceCents: int = 0
    durationDays: int = 0
    quotaGb: int = 0
    speedUpKbps: int = 0
    speedDnKbps: int = 0
    ipLimit: int = 2
    active: bool = True


class BotIn(BaseModel):
    enabled: Optional[bool] = None
    token: Optional[str] = None
    adminChatId: Optional[str] = None
    welcomeText: Optional[str] = None
    autoDeleteMinutes: Optional[int] = None
    paymentInstructions: Optional[str] = None
    paymentQrUrl: Optional[str] = None


class SettingsIn(BaseModel):
    domain: Optional[str] = None
    port: Optional[int] = None
    tlsMode: Optional[str] = None
    dnsProvider: Optional[str] = None
    rootDomain: Optional[str] = None
    repoUrl: Optional[str] = None
    tlsPorts: Optional[list[int]] = None
    plainPorts: Optional[list[int]] = None
    endpoints: Optional[dict[str, dict[str, Any]]] = None
    sshBanner: Optional[str] = None
    autoSuspend: Optional[bool] = None
    webhookUrl: Optional[str] = None
    webhookSecret: Optional[str] = None



class PasswordIn(BaseModel):
    current: str
    next: str


class PaymentBotIn(BaseModel):
    telegramId: str
    telegramName: str
    planId: str
    fileId: str


class BulkIn(BaseModel):
    action: str
    ids: list[str]
    days: Optional[int] = None


class CsvIn(BaseModel):
    csv: str


class DecisionIn(BaseModel):
    status: str
    reason: Optional[str] = None


class BackupIn(BaseModel):
    destination: str = "local"


class CreditIn(BaseModel):
    amountCents: int
    reason: str = "Manual credit"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def run(cmd: list[str], check=False) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return default


def _port_list(raw: str, defaults: Iterable[int], allowed: set[int]) -> list[int]:
    out: list[int] = []
    for item in str(raw or "").replace(" ", ",").split(","):
        p = _safe_int(item, 0)
        if p in allowed and p not in out:
            out.append(p)
    return out or [p for p in defaults if p in allowed]


def verify_admin_password(password: str) -> bool:
    if not ADMIN_HASH:
        return False
    try:
        if ADMIN_HASH.startswith("$argon2"):
            return argon2.verify(password, ADMIN_HASH)
        import crypt as _c
        return _c.crypt(password, ADMIN_HASH) == ADMIN_HASH
    except Exception:
        return False


def update_env_value(key: str, value: str) -> None:
    env_path = Path("/etc/autoscript/agent.env")
    if not env_path.exists():
        return
    lines = env_path.read_text().splitlines()
    out: list[str] = []
    done = False
    safe = value.replace("'", "'\\''")
    for line in lines:
        if line.startswith(f"{key}="):
            out.append(f"{key}='{safe}'")
            done = True
        else:
            out.append(line)
    if not done:
        out.append(f"{key}='{safe}'")
    env_path.write_text("\n".join(out) + "\n")


def _col(r: sqlite3.Row, key: str, default=None):
    try:
        return r[key]
    except (IndexError, KeyError):
        return default


def row_to_account(r: sqlite3.Row) -> dict:
    return {
        "id": _col(r, "id"), "protocol": _col(r, "protocol", "ssh"),
        "username": _col(r, "username", ""),
        "password": _col(r, "password"), "uuid": _col(r, "uuid"),
        "createdAt": _col(r, "created_at", ""), "expiresAt": _col(r, "expires_at", ""),
        "ipLimit": _col(r, "ip_limit", 0),
        "speedUpKbps": _col(r, "speed_up_kbps", 0),
        "speedDnKbps": _col(r, "speed_dn_kbps", 0),
        "quotaGb": _col(r, "quota_gb", 0),
        "usedBytes": _col(r, "used_bytes", 0), "online": 0,
        "status": _col(r, "status", "active"),
        "telegramId": _col(r, "telegram_id"), "planId": _col(r, "plan_id"),
        "note": _col(r, "note"),
    }


def ssh_login_username(username: str) -> str:
    """Linux login used for SSH accounts. Panel usernames stay clean/simple."""
    base = re.sub(r"[^A-Za-z0-9_-]", "-", username.strip()) or "user"
    raw = f"grvpn-{base}"
    if len(raw) <= 32:
        return raw
    digest = hashlib.sha256(base.encode()).hexdigest()[:8]
    return f"grvpn-{base[:17]}-{digest}"


CF_TLS_PORTS = {443, 2053, 2083, 2087, 2096, 8443}
CF_PLAIN_PORTS = {80, 8080, 8880, 2052, 2082, 2086, 2095}


def _tls_ports() -> list[int]:
    return _port_list(kv_get("panel.tlsPorts", "443,2053,2083,2087,2096,8443"), [443, 2053, 2083, 2087, 2096, 8443], CF_TLS_PORTS)


def _plain_ports() -> list[int]:
    return _port_list(kv_get("panel.plainPorts", "80,8080,8880,2052,2082,2086,2095"), [80, 8080, 8880, 2052, 2082, 2086, 2095], CF_PLAIN_PORTS)


def _proto_host(proto: str) -> str:
    return kv_get(f"hosts.{proto}", "") or kv_get("panel.domain", PANEL_DOMAIN)


def _panel_public_url(path: str) -> str:
    domain = kv_get("panel.domain", PANEL_DOMAIN)
    port = _safe_int(kv_get("panel.port", str(PANEL_PORT)), PANEL_PORT)
    suffix = "" if port == 443 else f":{port}"
    return f"https://{domain}{suffix}{path}"


def _vmess_link(username: str, host: str, port: int, uid: str, *, tls: bool) -> str:
    cfg = {
        "v": "2", "ps": f"{username}-{'tls' if tls else 'plain'}", "add": host,
        "port": port, "id": uid, "aid": 0, "net": "ws", "type": "none",
        "host": host, "path": "/vmess", "tls": "tls" if tls else "",
    }
    return "vmess://" + base64.b64encode(json.dumps(cfg, separators=(",", ":")).encode()).decode()


def _xray_uri(proto: str, username: str, host: str, port: int, uid: str, *, tls: bool, network: str = "ws") -> str:
    path = f"/{proto}" if network == "ws" else f"/{proto}-xh"
    security = "tls" if tls else "none"
    suffix = quote(username, safe="")
    if proto == "vless":
        return f"vless://{uid}@{host}:{port}?type={network}&security={security}&host={quote(host)}&path={quote(path, safe='')}&sni={quote(host)}#{suffix}"
    return f"trojan://{uid}@{host}:{port}?type={network}&security={security}&host={quote(host)}&path={quote(path, safe='')}&sni={quote(host)}#{suffix}"


def _vmess_link_net(username: str, host: str, port: int, uid: str, *, tls: bool, network: str = "ws") -> str:
    path = "/vmess" if network == "ws" else "/vmess-xh"
    cfg = {
        "v": "2", "ps": username, "add": host, "port": str(port), "id": uid,
        "aid": "0", "scy": "auto", "net": network, "type": "none",
        "host": host, "path": path, "tls": "tls" if tls else "", "sni": host if tls else "",
    }
    return "vmess://" + base64.b64encode(json.dumps(cfg, separators=(",", ":")).encode()).decode()


def connection_profiles(a: dict) -> list[dict[str, Any]]:
    host = _proto_host(a["protocol"])
    tls_ports = _tls_ports()
    plain_ports = _plain_ports()
    out: list[dict[str, Any]] = []
    if a["protocol"] == "ssh":
        login_user = ssh_login_username(a["username"])
        out.append({
            "label": "SSH direct", "network": "tcp", "security": "none", "host": host,
            "port": 22, "path": "", "username": login_user, "password": a.get("password") or "",
            "link": f"ssh://{quote(login_user)}:{quote(a.get('password') or '')}@{host}:22",
            "text": f"Host: {host}\nPort: 22\nUsername: {login_user}\nPassword: {a.get('password') or ''}",
        })
        for p in tls_ports:
            out.append({
                "label": f"SSH WS · TLS :{p}", "network": "ws", "security": "tls", "host": host,
                "port": p, "path": "/", "username": login_user, "password": a.get("password") or "",
                "link": f"ssh-ws://{quote(login_user)}:{quote(a.get('password') or '')}@{host}:{p}/?security=tls",
                "text": f"Host/SNI: {host}\nPort: {p}\nTLS: on\nWebSocket path: /\nUsername: {login_user}\nPassword: {a.get('password') or ''}",
            })
        for p in plain_ports:
            out.append({
                "label": f"SSH WS · plain :{p}", "network": "ws", "security": "none", "host": host,
                "port": p, "path": "/", "username": login_user, "password": a.get("password") or "",
                "link": f"ssh-ws://{quote(login_user)}:{quote(a.get('password') or '')}@{host}:{p}/?security=none",
                "text": f"Host: {host}\nPort: {p}\nTLS: off\nWebSocket path: /\nUsername: {login_user}\nPassword: {a.get('password') or ''}",
            })
        return out
    uid = a.get("uuid") or ""
    proto = a["protocol"]
    def _mk(port: int, tls: bool, network: str):
        if proto == "vmess":
            link = _vmess_link_net(a["username"], host, port, uid, tls=tls, network=network)
        else:
            link = _xray_uri(proto, a["username"], host, port, uid, tls=tls, network=network)
        transport = "WS" if network == "ws" else "xHTTP"
        sec = "TLS" if tls else "plain"
        path = f"/{proto}" if network == "ws" else f"/{proto}-xh"
        return {
            "label": f"{proto.upper()} · {transport} · {sec} :{port}",
            "network": network, "security": "tls" if tls else "none",
            "host": host, "port": port, "path": path, "link": link, "text": link,
        }
    for p in tls_ports:
        out.append(_mk(p, True, "ws"))
        out.append(_mk(p, True, "xhttp"))
    for p in plain_ports:
        out.append(_mk(p, False, "ws"))
        out.append(_mk(p, False, "xhttp"))
    return out



def active_ips_for_account(a: dict) -> list[dict[str, str]]:
    if a["protocol"] != "ssh":
        return []
    user = ssh_login_username(a["username"])
    try:
        if run(["id", "-u", user]).returncode != 0:
            return []
        pids = [p for p in run(["pgrep", "-u", user, "sshd"]).stdout.split() if p.isdigit()]
        if not pids:
            return []
        pid_re = "|".join(pids)
        r = run(["bash", "-lc", f"ss -tnp 2>/dev/null | grep -E 'pid=({pid_re}),' | awk '{{print $5}}' | sed 's/::ffff://' | sed 's/:.*//' | sort -u"])
        ips = [x.strip() for x in r.stdout.splitlines() if x.strip() and x.strip() not in {"127.0.0.1", "0.0.0.0"}]
        return [{"ip": ip, "country": "", "lastSeen": datetime.now(timezone.utc).isoformat()} for ip in ips]
    except Exception:
        return []



def row_to_plan(r: sqlite3.Row) -> dict:
    return {"id": _col(r, "id"), "name": _col(r, "name", ""), "mode": _col(r, "mode", "prepaid"),
            "priceCents": _col(r, "price_cents", 0), "durationDays": _col(r, "duration_days", 0),
            "quotaGb": _col(r, "quota_gb", 0), "speedUpKbps": _col(r, "speed_up_kbps", 0),
            "speedDnKbps": _col(r, "speed_dn_kbps", 0), "ipLimit": _col(r, "ip_limit", 2),
            "active": bool(_col(r, "active", 1))}


def apply_speed_limit(username: str, up_kbps: int, dn_kbps: int) -> None:
    script = SCRIPTS / "tc_limit.sh"
    if script.exists():
        run(["bash", str(script), username, str(up_kbps), str(dn_kbps)])


def provision_account(a: dict) -> None:
    script = SCRIPTS / f"provision_{a['protocol']}.sh"
    if script.exists():
        env = {**os.environ,
               "USERNAME": a["username"], "PASSWORD": a.get("password") or "",
               "SYSTEM_USERNAME": ssh_login_username(a["username"]) if a["protocol"] == "ssh" else a["username"],
               "UUID": a.get("uuid") or "", "EXPIRES": a["expiresAt"],
               "IP_LIMIT": str(a["ipLimit"]), "QUOTA_GB": str(a["quotaGb"])}
        r = subprocess.run(["bash", str(script)], env=env, capture_output=True, text=True, check=False)
        if r.returncode != 0:
            raise HTTPException(500, (r.stderr or r.stdout or "Provisioning failed").strip()[:500])
    limit_user = ssh_login_username(a["username"]) if a["protocol"] == "ssh" else a["username"]
    apply_speed_limit(limit_user, a["speedUpKbps"], a["speedDnKbps"])


def revoke_account(a: dict) -> None:
    script = SCRIPTS / f"revoke_{a['protocol']}.sh"
    if script.exists():
        env = {**os.environ, "SYSTEM_USERNAME": ssh_login_username(a["username"]) if a["protocol"] == "ssh" else a["username"]}
        subprocess.run(["bash", str(script), a["username"]], env=env, check=False)


# ---------------------------------------------------------------------------
# SSH banner (with template variables) + auto-suspend scheduler
# ---------------------------------------------------------------------------
DEFAULT_SSH_BANNER = """<div style="text-align:center;">
    <h4><font color="#ffff">⚡️GR VPN SSH</font></h4>
    <h4><font color="green">⚡️Term of services</font></h4>
    <h3><font color="yellow">⚡️No Spam</font></h3>
    <h3><font color="#ffff">⚡️No Hacking</font></h3>
    <h3><font color="blue">⚡️No DDOS</font></h3>
    <h1><font color="#F6BE00">⚡️No Multi login, Auto delete</font></h1>
    <h3><font color="red">GR VPN</font></h3>
</div>
"""

BANNER_VARIABLES = {
    "{{DOMAIN}}":       "Panel main domain",
    "{{SERVER_IP}}":    "Server public IP",
    "{{TOTAL_USERS}}":  "Total accounts in panel",
    "{{ONLINE_USERS}}": "Currently online users (any protocol)",
    "{{UPTIME}}":       "Server uptime (e.g. '3d 4h')",
    "{{DATE}}":         "Server date (YYYY-MM-DD)",
    "{{TIME}}":         "Server time (HH:MM UTC)",
    # Per-user (only substituted for post-login MOTD, not pre-auth banner)
    "{{USERNAME}}":     "SSH panel username",
    "{{IP_LIMIT}}":     "Max concurrent IPs allowed",
    "{{DAYS_LEFT}}":    "Days until account expiry",
    "{{EXPIRES}}":      "Expiry date (YYYY-MM-DD)",
    "{{USED_GB}}":      "Data used (GB)",
    "{{QUOTA_GB}}":     "Quota (GB, 0 = unlimited)",
    "{{REMAINING_GB}}": "Remaining quota (GB)",
    "{{STATUS}}":       "active / locked / suspended",
}


def _server_ip() -> str:
    try:
        return subprocess.check_output(["bash", "-lc", "curl -fsS4 --max-time 2 ifconfig.me || hostname -I | awk '{print $1}'"], text=True).strip()
    except Exception:
        return ""


def _fmt_uptime(seconds: float) -> str:
    s = int(seconds); d, s = divmod(s, 86400); h, s = divmod(s, 3600); m, _ = divmod(s, 60)
    if d: return f"{d}d {h}h"
    if h: return f"{h}h {m}m"
    return f"{m}m"


def _global_banner_vars() -> dict[str, str]:
    now = datetime.now(timezone.utc)
    try:
        total = 0; online = 0
        with db() as c:
            total = int(c.execute("SELECT COUNT(*) AS n FROM accounts").fetchone()["n"])
            rows = c.execute("SELECT * FROM accounts").fetchall()
            for r in rows:
                if len(active_ips_for_account(row_to_account(r))) > 0:
                    online += 1
    except Exception:
        total = 0; online = 0
    try:
        up = time.time() - psutil.boot_time()
    except Exception:
        up = 0
    return {
        "{{DOMAIN}}":       kv_get("panel.domain", PANEL_DOMAIN),
        "{{SERVER_IP}}":    kv_get("cache.server_ip", "") or _server_ip(),
        "{{TOTAL_USERS}}":  str(total),
        "{{ONLINE_USERS}}": str(online),
        "{{UPTIME}}":       _fmt_uptime(up),
        "{{DATE}}":         now.strftime("%Y-%m-%d"),
        "{{TIME}}":         now.strftime("%H:%M UTC"),
    }


def render_banner(template: str, extra: Optional[dict[str, str]] = None) -> str:
    out = template
    vars_ = _global_banner_vars()
    if extra:
        vars_.update(extra)
    # Strip any per-user placeholders that weren't provided (pre-auth context)
    for placeholder in BANNER_VARIABLES:
        out = out.replace(placeholder, vars_.get(placeholder, ""))
    return out


def write_pre_auth_banner() -> None:
    tpl = kv_get("ssh.banner", DEFAULT_SSH_BANNER)
    try:
        Path("/etc/grvpn-ssh-banner.html").write_text(render_banner(tpl), encoding="utf-8")
    except Exception as exc:
        print(f"banner-write-failed: {exc}", flush=True)


def auto_suspend_tick() -> None:
    """Lock accounts whose expiry has passed or whose quota is exhausted."""
    if kv_get("panel.autoSuspend", "1") != "1":
        return
    now = datetime.now(timezone.utc)
    to_lock: list[dict] = []
    try:
        with db() as c:
            rows = c.execute("SELECT * FROM accounts WHERE status = 'active'").fetchall()
            for r in rows:
                a = row_to_account(r)
                over_quota = False
                if int(a.get("quotaGb") or 0) > 0:
                    limit = int(a["quotaGb"]) * 1024 ** 3
                    if int(a.get("usedBytes") or 0) >= limit:
                        over_quota = True
                try:
                    exp = datetime.fromisoformat(a["expiresAt"].replace("Z", "+00:00"))
                except Exception:
                    exp = now + timedelta(days=365)
                expired = exp <= now
                if expired or over_quota:
                    c.execute("UPDATE accounts SET status = 'suspended' WHERE id = ?", (a["id"],))
                    a["_reason"] = "expired" if expired else "over_quota"
                    to_lock.append(a)
    except Exception as exc:
        print(f"auto-suspend-tick-failed: {exc}", flush=True)
        return
    for a in to_lock:
        try:
            revoke_account(a)
            log("audit", "account.autoSuspend",
                f"Auto-suspended {a['username']} ({a.get('_reason')})",
                actor="scheduler", target=a["username"], level="warn")
        except Exception as exc:
            print(f"auto-suspend-revoke-failed {a.get('username')}: {exc}", flush=True)


def _xray_stats_query(reset: bool = True) -> dict[str, dict[str, int]]:
    """Return {username: {"up": bytes, "down": bytes}} since last reset."""
    out: dict[str, dict[str, int]] = {}
    for candidate in (["xray", "api", "statsquery", "--server=127.0.0.1:10085"],
                      ["/usr/local/bin/xray", "api", "statsquery", "--server=127.0.0.1:10085"]):
        if reset:
            candidate = candidate + ["-reset"]
        try:
            res = subprocess.run(candidate + ["-pattern", "user>>>"], capture_output=True, text=True, timeout=5)
            if res.returncode != 0:
                continue
            data = json.loads(res.stdout or "{}")
            for item in (data.get("stat") or []):
                name = item.get("name", "")
                # user>>>{email}>>>traffic>>>uplink | downlink
                parts = name.split(">>>")
                if len(parts) < 4 or parts[0] != "user":
                    continue
                email = parts[1]
                kind = parts[3]
                val = int(item.get("value") or 0)
                slot = out.setdefault(email, {"up": 0, "down": 0})
                if kind == "uplink":
                    slot["up"] += val
                elif kind == "downlink":
                    slot["down"] += val
            return out
        except Exception:
            continue
    return out


def _ssh_traffic_read(username: str) -> tuple[int, int]:
    """Read+zero iptables byte counters for SSH user's owner chain.
    Returns (rx_from_client, tx_to_client). Chain missing → (0, 0)."""
    chain = f"AS_{username[:20]}"
    try:
        res = subprocess.run(["iptables", "-nvxL", chain, "-Z"], capture_output=True, text=True, timeout=3)
        if res.returncode != 0:
            return (0, 0)
        rx = tx = 0
        # iptables -Z resets counters as it reads.
        for line in res.stdout.splitlines():
            parts = line.split()
            if len(parts) < 2 or not parts[0].isdigit():
                continue
            b = int(parts[1])
            if "owner" in line and "OUT" in line:
                tx += b
            elif "owner" in line and "IN" in line:
                rx += b
        return (rx, tx)
    except Exception:
        return (0, 0)


def _traffic_tick() -> None:
    """Every 60s: pull xray + ssh per-user counters, roll into daily table,
    update accounts.used_bytes, and fire outbound webhook if configured."""
    try:
        xstats = _xray_stats_query(reset=True)
    except Exception as exc:
        print(f"traffic-xray-failed: {exc}", flush=True)
        xstats = {}

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    deltas: list[dict] = []
    try:
        with db() as c:
            rows = c.execute("SELECT id, username, protocol FROM accounts").fetchall()
            for r in rows:
                aid = r["id"]; uname = r["username"]; proto = r["protocol"]
                if proto == "ssh":
                    rx, tx = _ssh_traffic_read(uname)
                else:
                    s = xstats.get(uname) or {}
                    rx = int(s.get("up") or 0)   # client → server = user upload
                    tx = int(s.get("down") or 0) # server → client = user download
                if rx == 0 and tx == 0:
                    continue
                c.execute(
                    "INSERT INTO account_traffic(account_id, day, rx_bytes, tx_bytes) VALUES(?,?,?,?) "
                    "ON CONFLICT(account_id, day) DO UPDATE SET rx_bytes = rx_bytes + excluded.rx_bytes, "
                    "tx_bytes = tx_bytes + excluded.tx_bytes",
                    (aid, day, rx, tx),
                )
                c.execute("UPDATE accounts SET used_bytes = COALESCE(used_bytes,0) + ? WHERE id = ?",
                          (rx + tx, aid))
                deltas.append({"accountId": aid, "username": uname, "protocol": proto,
                               "rxBytes": rx, "txBytes": tx})
    except Exception as exc:
        print(f"traffic-tick-failed: {exc}", flush=True)
        return

    if deltas:
        _fire_traffic_webhook(deltas)


def _fire_traffic_webhook(deltas: list[dict]) -> None:
    url = kv_get("webhook.url", "").strip()
    if not url:
        return
    secret = kv_get("webhook.secret", "").strip()
    payload = json.dumps({"type": "traffic.delta", "at": datetime.now(timezone.utc).isoformat(),
                          "items": deltas}).encode()
    headers = {"Content-Type": "application/json", "User-Agent": "autoscript-webhook/1"}
    if secret:
        import hmac as _h, hashlib as _hh
        sig = _h.new(secret.encode(), payload, _hh.sha256).hexdigest()
        headers["X-Autoscript-Signature"] = f"sha256={sig}"
    try:
        import urllib.request
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        urllib.request.urlopen(req, timeout=5).read()
    except Exception as exc:
        print(f"webhook-failed: {exc}", flush=True)


def _account_traffic_buckets(aid: str) -> dict:
    """Today / this-week / this-month totals and daily buckets for the last 30 days."""
    today = datetime.now(timezone.utc).date()
    with db() as c:
        rows = c.execute(
            "SELECT day, rx_bytes, tx_bytes FROM account_traffic WHERE account_id = ? AND day >= ? ORDER BY day",
            (aid, (today - timedelta(days=30)).isoformat()),
        ).fetchall()
    daily = [{"day": r["day"], "rxBytes": int(r["rx_bytes"]), "txBytes": int(r["tx_bytes"]),
              "totalBytes": int(r["rx_bytes"]) + int(r["tx_bytes"])} for r in rows]
    by_day = {d["day"]: d for d in daily}
    monday = today - timedelta(days=today.weekday())
    first = today.replace(day=1)
    tot_today = by_day.get(today.isoformat(), {"totalBytes": 0})["totalBytes"]
    tot_week = sum(d["totalBytes"] for d in daily if d["day"] >= monday.isoformat())
    tot_month = sum(d["totalBytes"] for d in daily if d["day"] >= first.isoformat())
    tot_all = sum(d["totalBytes"] for d in daily)
    return {"today": tot_today, "week": tot_week, "month": tot_month, "last30d": tot_all, "daily": daily}


def _scheduler_loop() -> None:
    # First tick after 30s so the panel finishes booting; then every 60s.
    time.sleep(30)
    while True:
        try:
            auto_suspend_tick()
        except Exception as exc:
            print(f"scheduler-error: {exc}", flush=True)
        try:
            _traffic_tick()
        except Exception as exc:
            print(f"traffic-tick-error: {exc}", flush=True)
        # Refresh the pre-auth banner every 5 minutes so counters stay current.
        try:
            if int(time.time()) // 60 % 5 == 0:
                write_pre_auth_banner()
        except Exception:
            pass
        time.sleep(60)



# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Autoscript Panel Agent", version="1.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"], allow_credentials=True)


@app.on_event("startup")
def _start_scheduler() -> None:
    import threading
    write_pre_auth_banner()
    t = threading.Thread(target=_scheduler_loop, name="autoscript-scheduler", daemon=True)
    t.start()



# Secret-path gate + /api prefix stripping.
#
# Panel URL = https://<domain>:<port>/<PANEL_PATH>/
# The first request to /<PANEL_PATH>/... sets an HttpOnly cookie so subsequent
# asset/API requests (which come back with plain absolute paths like
# /assets/foo.js and /api/auth/login) succeed. Everything else is 404'd and
# the reject is logged in a fail2ban-friendly format.
import hmac as _hmac
import hashlib as _hashlib

def _gate_token() -> str:
    return _hmac.new(GATE_SECRET.encode(), PANEL_PATH.encode(), _hashlib.sha256).hexdigest()[:32]

@app.middleware("http")
async def _panel_gate(request: Request, call_next):
    from starlette.responses import Response as _R
    scope = request.scope
    path  = scope.get("path", "") or "/"
    client_ip = (request.client.host if request.client else "-")

    # If a secret path is configured, enforce it.
    if PANEL_PATH:
        pfx = f"/{PANEL_PATH}"
        gate_ok = request.cookies.get("panel_gate") == _gate_token()
        under_pfx = path == pfx or path.startswith(pfx + "/")
        # Requests that use the secret prefix: strip it and mint the cookie.
        if under_pfx:
            new_path = path[len(pfx):] or "/"
            accept = request.headers.get("accept", "")
            if request.method in ("GET", "HEAD") and "text/html" in accept:
                from starlette.responses import RedirectResponse as _Redirect
                target = new_path
                if request.url.query:
                    target += "?" + request.url.query
                resp = _Redirect(target, status_code=302)
                resp.set_cookie("panel_gate", _gate_token(),
                                httponly=True, secure=True, samesite="lax",
                                max_age=60 * 60 * 24 * 30)
                return resp
            scope["path"] = new_path
            raw = scope.get("raw_path")
            if isinstance(raw, (bytes, bytearray)) and raw.startswith(pfx.encode()):
                scope["raw_path"] = raw[len(pfx):] or b"/"
            resp = await _strip_api_and_call(request, call_next)
            resp.set_cookie("panel_gate", _gate_token(),
                            httponly=True, secure=True, samesite="lax",
                            max_age=60 * 60 * 24 * 30)
            return resp
        public_path = (
            path.startswith("/u/") or path.startswith("/assets/") or
            path.startswith("/api/public/") or path in ("/favicon.ico", "/manifest.webmanifest")
        )
        if public_path:
            return await _strip_api_and_call(request, call_next)
        # No prefix — allow only when the gate cookie is already present
        # (for /assets/*, /api/*, and SPA sub-routes rendered client-side).
        if not gate_ok:
            print(f"panel-gate-reject {client_ip} path={path}", flush=True)
            return _R("Not Found", status_code=404)

    return await _strip_api_and_call(request, call_next)


async def _strip_api_and_call(request: Request, call_next):
    scope = request.scope
    p = scope.get("path", "")
    if p.startswith("/api/"):
        scope["path"] = p[4:]
        raw = scope.get("raw_path")
        if isinstance(raw, (bytes, bytearray)) and raw.startswith(b"/api/"):
            scope["raw_path"] = raw[4:]
    elif p == "/api":
        scope["path"] = "/"
    return await call_next(request)


# ---- Auth ------------------------------------------------------------------
@app.post("/auth/login")
def auth_login(inp: LoginIn, request: Request, response: Response):
    ok = inp.username == ADMIN_USER and verify_admin_password(inp.password)
    client_ip = (request.client.host if request.client else "-")
    if not ok:
        print(f"Failed login for {inp.username} from {client_ip}", flush=True)
        log("auth", "auth.login.fail", f"Failed login for {inp.username} from {client_ip}", level="warn", actor=inp.username)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    token = make_token(inp.username)
    response.set_cookie("token", token, httponly=True, secure=True, samesite="lax", max_age=JWT_TTL)
    log("auth", "auth.login", f"{inp.username} signed in", actor=inp.username)
    return {"ok": True, "token": token}


@app.post("/auth/logout")
def auth_logout(response: Response):
    response.delete_cookie("token"); return {"ok": True}


@app.get("/auth/me")
def auth_me(user: str = Depends(require_auth)):
    return {"username": user}


# ---- System ----------------------------------------------------------------
@app.get("/system/status")
def system_status(_: str = Depends(require_auth)):
    vm = psutil.virtual_memory(); du = psutil.disk_usage("/")
    n1 = psutil.net_io_counters(); time.sleep(0.3); n2 = psutil.net_io_counters()
    services = []
    for svc in ("xray", "ssh", "autoscript-ssh-ws", "nginx", "autoscript-agent", "autoscript-bot"):
        r = run(["systemctl", "is-active", svc])
        services.append({"name": svc, "running": r.stdout.strip() == "active"})
    try:
        os_name = Path("/etc/os-release").read_text().split("PRETTY_NAME=")[1].split("\n")[0].strip('"')
    except Exception:
        os_name = "linux"
    return {
        "uptimeSeconds": int(time.time() - psutil.boot_time()),
        "cpuPercent": psutil.cpu_percent(interval=0.2),
        "memoryPercent": vm.percent,
        "memoryUsedMb": vm.used // 1024 // 1024, "memoryTotalMb": vm.total // 1024 // 1024,
        "diskPercent": du.percent,
        "diskUsedGb": round(du.used / 1024**3, 1), "diskTotalGb": round(du.total / 1024**3, 1),
        "netRxMbps": round((n2.bytes_recv - n1.bytes_recv) * 8 / 0.3 / 1_000_000, 2),
        "netTxMbps": round((n2.bytes_sent - n1.bytes_sent) * 8 / 0.3 / 1_000_000, 2),
        "services": services, "hostname": os.uname().nodename, "os": os_name,
        "kernel": os.uname().release,
        "ipv4": (run(["hostname", "-I"]).stdout.split() or ["0.0.0.0"])[0],
    }


@app.get("/system/traffic")
def system_traffic(range: str = "24h", _: str = Depends(require_auth)):
    if range in ("1h", "hourly"):
        since_min = 60; bucket_sec = 60
    elif range in ("24h", "daily", "today"):
        since_min = 60 * 24; bucket_sec = 3600
    elif range in ("7d", "weekly", "week"):
        since_min = 60 * 24 * 7; bucket_sec = 3600 * 6
    elif range in ("30d", "monthly", "month"):
        since_min = 60 * 24 * 30; bucket_sec = 86400
    elif range in ("365d", "yearly", "year"):
        since_min = 60 * 24 * 365; bucket_sec = 86400 * 7
    else:
        since_min = 60 * 24; bucket_sec = 3600
    since = datetime.now(timezone.utc) - timedelta(minutes=since_min)
    with db() as c:
        rows = c.execute(
            "SELECT ts, rx_bytes, tx_bytes FROM traffic_samples WHERE ts >= ? ORDER BY ts",
            (since.isoformat(),)
        ).fetchall()
    # bucket
    buckets: dict[int, list[int]] = {}
    for r in rows:
        t = datetime.fromisoformat(r["ts"]).timestamp()
        key = int(t // bucket_sec) * bucket_sec
        b = buckets.setdefault(key, [0, 0])
        b[0] += r["rx_bytes"]; b[1] += r["tx_bytes"]
    return [
        {"t": datetime.fromtimestamp(k, timezone.utc).isoformat(), "rxBytes": v[0], "txBytes": v[1]}
        for k, v in sorted(buckets.items())
    ]


@app.get("/system/version")
def system_version(_: str = Depends(require_auth)):
    try:
        cur = subprocess.check_output(["git", "-C", INSTALL_ROOT, "rev-parse", "--short", "HEAD"], text=True).strip()
        cur_date = subprocess.check_output(["git", "-C", INSTALL_ROOT, "log", "-1", "--format=%cI"], text=True).strip()
        run(["git", "-C", INSTALL_ROOT, "fetch", "--quiet"])
        latest = subprocess.check_output(["git", "-C", INSTALL_ROOT, "rev-parse", "--short", "origin/main"], text=True).strip()
        latest_date = subprocess.check_output(["git", "-C", INSTALL_ROOT, "log", "-1", "--format=%cI", "origin/main"], text=True).strip()
        behind = int(subprocess.check_output(
            ["git", "-C", INSTALL_ROOT, "rev-list", "--count", "HEAD..origin/main"], text=True).strip())
    except Exception:
        cur = latest = "unknown"; cur_date = latest_date = ""; behind = 0
    return {"currentCommit": cur, "currentDate": cur_date, "latestCommit": latest,
            "latestDate": latest_date, "behind": behind, "repo": REPO_URL}


@app.post("/system/update")
def system_update(user: str = Depends(require_auth)):
    run(["git", "-C", INSTALL_ROOT, "fetch", "--all", "--prune"])
    try:
        commit = subprocess.check_output(["git", "-C", INSTALL_ROOT, "rev-parse", "--short", "origin/main"], text=True).strip()
    except Exception:
        commit = "queued"
    cmd = "nohup /usr/local/bin/autoscript update >> /var/log/autoscript-update.log 2>&1 &"
    subprocess.Popen(["bash", "-lc", cmd], start_new_session=True)
    log("audit", "system.update", f"Update queued for {commit}", actor=user)
    return {"ok": True, "commit": commit}


@app.post("/system/restart/{svc}")
def system_restart(svc: str, user: str = Depends(require_auth)):
    if svc not in ("xray", "nginx", "autoscript-agent", "autoscript-web", "autoscript-bot", "autoscript-ssh-ws"):
        raise HTTPException(400, "Not allowed")
    if svc == "xray":
        setup = SCRIPTS / "setup_xray.sh"
        if setup.exists():
            subprocess.run(["bash", str(setup)], capture_output=True, text=True, check=False)
    subprocess.Popen(["systemctl", "restart", svc])
    log("audit", "system.restart", f"Restart {svc}", actor=user); return {"ok": True}


@app.post("/system/repair")
def system_repair(user: str = Depends(require_auth)):
    cli = "/usr/local/bin/autoscript"
    repo_cli = INSTALL_ROOT / "backend" / "cli.sh"
    if repo_cli.exists():
        subprocess.run(["install", "-m", "755", str(repo_cli), cli], check=False)
    cmd = f"nohup {cli} repair-services >> /var/log/autoscript-repair.log 2>&1 &"
    subprocess.Popen(["bash", "-lc", cmd], start_new_session=True)
    log("audit", "system.repair", "Service repair queued", actor=user, level="warn")
    return {"ok": True}


# ---- Accounts --------------------------------------------------------------
@app.get("/accounts")
def accounts_list(protocol: Optional[str] = None, _: str = Depends(require_auth)):
    with db() as c:
        q = "SELECT * FROM accounts"; args: tuple = ()
        if protocol: q += " WHERE protocol = ?"; args = (protocol,)
        q += " ORDER BY created_at DESC"
        rows = c.execute(q, args).fetchall()
    items = [row_to_account(r) for r in rows]
    for a in items:
        a["online"] = len(active_ips_for_account(a))
    return items


@app.post("/accounts/bulk")
def accounts_bulk(inp: BulkIn, user: str = Depends(require_auth)):
    if inp.action not in ("extend", "delete", "lock", "unlock"):
        raise HTTPException(400, "Invalid bulk action")
    if not inp.ids:
        return {"ok": True, "changed": 0}
    changed = 0
    with db() as c:
        rows = c.execute(
            f"SELECT * FROM accounts WHERE id IN ({','.join('?' for _ in inp.ids)})",
            tuple(inp.ids),
        ).fetchall()
        for r in rows:
            a = row_to_account(r)
            if inp.action == "delete":
                c.execute("DELETE FROM accounts WHERE id = ?", (a["id"],)); revoke_account(a)
            elif inp.action == "lock":
                c.execute("UPDATE accounts SET status = 'locked' WHERE id = ?", (a["id"],))
            elif inp.action == "unlock":
                c.execute("UPDATE accounts SET status = 'active' WHERE id = ?", (a["id"],))
            elif inp.action == "extend":
                days = inp.days or 30
                try:
                    cur = datetime.fromisoformat(a["expiresAt"].replace("Z", "+00:00"))
                except Exception:
                    cur = datetime.now(timezone.utc)
                new_exp = max(cur, datetime.now(timezone.utc)) + timedelta(days=days)
                c.execute("UPDATE accounts SET expires_at = ? WHERE id = ?", (new_exp.isoformat(), a["id"]))
            changed += 1
    log("audit", "account.bulk", f"Bulk {inp.action} on {changed} accounts", actor=user)
    return {"ok": True, "changed": changed}


@app.get("/accounts/export")
def accounts_export(_: str = Depends(require_auth)):
    with db() as c:
        rows = c.execute("SELECT * FROM accounts ORDER BY created_at DESC").fetchall()
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["protocol", "username", "password", "uuid", "expiresAt", "ipLimit", "speedUpKbps", "speedDnKbps", "quotaGb", "telegramId"])
    for r in rows:
        a = row_to_account(r)
        w.writerow([a["protocol"], a["username"], a.get("password") or "", a.get("uuid") or "", a["expiresAt"], a["ipLimit"], a["speedUpKbps"], a["speedDnKbps"], a["quotaGb"], a.get("telegramId") or ""])
    return {"csv": out.getvalue()}


@app.post("/accounts/import")
def accounts_import(inp: CsvIn, user: str = Depends(require_auth)):
    created = 0
    reader = csv.DictReader(io.StringIO(inp.csv))
    for row in reader:
        try:
            proto = (row.get("protocol") or "ssh").strip().lower()
            if proto not in ("ssh", "vmess", "vless", "trojan"):
                continue
            expires = row.get("expiresAt") or (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
            accounts_create(AccountIn(
                protocol=proto,
                username=(row.get("username") or "").strip(),
                password=row.get("password") or None,
                expiresAt=expires,
                ipLimit=int(row.get("ipLimit") or 2),
                speedUpKbps=int(float(row.get("speedUpKbps") or 0)),
                speedDnKbps=int(float(row.get("speedDnKbps") or 0)),
                quotaGb=int(float(row.get("quotaGb") or 0)),
                telegramId=row.get("telegramId") or None,
            ), user)
            created += 1
        except Exception as exc:
            print(f"csv-import-skip: {exc}", flush=True)
    return {"created": created}


@app.get("/accounts/{aid}")
def accounts_get(aid: str, _: str = Depends(require_auth)):
    with db() as c:
        r = c.execute("SELECT * FROM accounts WHERE id = ?", (aid,)).fetchone()
    if not r: raise HTTPException(404, "Not found")
    a = row_to_account(r)
    a["online"] = len(active_ips_for_account(a))
    return a


@app.post("/accounts")
def accounts_create(inp: AccountIn, user: str = Depends(require_auth)):
    proto = inp.protocol.lower().strip()
    if proto not in ("ssh", "vmess", "vless", "trojan"):
        raise HTTPException(400, "Unsupported protocol")
    username = inp.username.strip()
    if not username:
        raise HTTPException(400, "Username is required")
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_-]{0,31}", username):
        raise HTTPException(400, "Username must be 1-32 chars: letters, numbers, underscore or dash")
    try:
        datetime.fromisoformat(inp.expiresAt.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "Invalid expiry date")
    password = inp.password or (_uuid.uuid4().hex[:12] if proto == "ssh" else None)
    aid = f"{proto}-{_uuid.uuid4().hex[:8]}"
    u = None if proto == "ssh" else str(_uuid.uuid4())
    try:
        with db() as c:
            c.execute("""INSERT INTO accounts(id,protocol,username,password,uuid,created_at,expires_at,
                         ip_limit,speed_up_kbps,speed_dn_kbps,quota_gb,telegram_id,plan_id,status)
                         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                      (aid, proto, username, password, u,
                       datetime.now(timezone.utc).isoformat(), inp.expiresAt,
                       max(0, inp.ipLimit), max(0, inp.speedUpKbps), max(0, inp.speedDnKbps), max(0, inp.quotaGb),
                       inp.telegramId or None, inp.planId or None, "trial" if inp.trial else "active"))
            r = c.execute("SELECT * FROM accounts WHERE id = ?", (aid,)).fetchone()
    except sqlite3.IntegrityError as exc:
        msg = str(exc).lower()
        if "unique" in msg and "username" in msg:
            raise HTTPException(409, "Username already exists")
        raise HTTPException(400, f"Account validation failed: {exc}")
    a = row_to_account(r)
    warning: str | None = None
    try:
        provision_account(a)
    except HTTPException as exc:
        # Keep the account, mark it pending so admin can retry, and surface the exact error.
        warning = str(exc.detail) if hasattr(exc, "detail") else "Provisioning failed"
        with db() as c:
            c.execute("UPDATE accounts SET status = 'pending' WHERE id = ?", (aid,))
            r = c.execute("SELECT * FROM accounts WHERE id = ?", (aid,)).fetchone()
        a = row_to_account(r)
        log("critical", "account.provision", f"Provisioning failed for {username}: {warning}",
            actor=user, target=username)
    log("audit", "account.create", f"Created {proto} account {username}" + (" (pending — see alerts)" if warning else ""),
        actor=user, target=username)
    if warning:
        a["warning"] = warning
    return a



@app.patch("/accounts/{aid}")
def accounts_update(aid: str, patch: AccountPatch, user: str = Depends(require_auth)):
    with db() as c:
        r = c.execute("SELECT * FROM accounts WHERE id = ?", (aid,)).fetchone()
        if not r: raise HTTPException(404, "Not found")
        fields, args = [], []
        m = {"password":"password","expiresAt":"expires_at","ipLimit":"ip_limit",
             "speedUpKbps":"speed_up_kbps","speedDnKbps":"speed_dn_kbps",
             "quotaGb":"quota_gb","telegramId":"telegram_id"}
        for k, col in m.items():
            v = getattr(patch, k)
            if v is not None: fields.append(f"{col} = ?"); args.append(v)
        if fields:
            c.execute(f"UPDATE accounts SET {', '.join(fields)} WHERE id = ?", (*args, aid))
        r = c.execute("SELECT * FROM accounts WHERE id = ?", (aid,)).fetchone()
    a = row_to_account(r)
    if a["protocol"] == "ssh" and (patch.password is not None or patch.expiresAt is not None):
        provision_account(a)
    elif patch.speedUpKbps is not None or patch.speedDnKbps is not None:
        limit_user = ssh_login_username(a["username"]) if a["protocol"] == "ssh" else a["username"]
        apply_speed_limit(limit_user, a["speedUpKbps"], a["speedDnKbps"])
    log("audit", "account.update", f"Updated {r['protocol']} account {r['username']}",
        actor=user, target=r["username"])
    return a


@app.delete("/accounts/{aid}")
def accounts_delete(aid: str, user: str = Depends(require_auth)):
    with db() as c:
        r = c.execute("SELECT * FROM accounts WHERE id = ?", (aid,)).fetchone()
        if not r: raise HTTPException(404, "Not found")
        c.execute("DELETE FROM accounts WHERE id = ?", (aid,))
    revoke_account(row_to_account(r))
    log("audit", "account.delete", f"Deleted {r['protocol']} account {r['username']}",
        actor=user, target=r["username"], level="warn")
    return {"ok": True}


@app.get("/accounts/{aid}/config")
def accounts_config(aid: str, user: str = Depends(require_auth)):
    a = accounts_get(aid, user)
    cfg = accounts_config_public(a)
    return cfg


@app.get("/accounts/{aid}/subscription")
def accounts_subscription(aid: str, user: str = Depends(require_auth)):
    accounts_get(aid, user)
    return {"url": _panel_public_url(f"/u/{aid}")}


@app.get("/accounts/{aid}/detail")
def accounts_detail(aid: str, user: str = Depends(require_auth)):
    return account_detail_payload(aid)


@app.get("/public/accounts/{aid}/detail")
def public_accounts_detail(aid: str):
    return account_detail_payload(aid)


@app.get("/accounts/{aid}/traffic")
def accounts_traffic(aid: str, _: str = Depends(require_auth)):
    with db() as c:
        r = c.execute("SELECT id FROM accounts WHERE id = ?", (aid,)).fetchone()
    if not r:
        raise HTTPException(404, "Not found")
    return _account_traffic_buckets(aid)


def account_detail_payload(aid: str):
    with db() as c:
        r = c.execute("SELECT * FROM accounts WHERE id = ?", (aid,)).fetchone()
    if not r:
        raise HTTPException(404, "Not found")
    a = row_to_account(r)
    cfg = accounts_config_public(a)
    ips = active_ips_for_account(a)
    a["online"] = len(ips)
    try:
        exp = datetime.fromisoformat(a["expiresAt"].replace("Z", "+00:00"))
        days = max(0, (exp - datetime.now(timezone.utc)).days)
    except Exception:
        days = 0
    limit_bytes = max(0, int(a.get("quotaGb") or 0)) * 1024 ** 3
    used = max(0, int(a.get("usedBytes") or 0))
    traffic = _account_traffic_buckets(aid)
    return {"account": a, "configLink": cfg["link"], "configText": cfg["text"],
            "subscriptionUrl": _panel_public_url(f"/u/{aid}"),
            "daysRemaining": days, "hourly": [], "daily": traffic["daily"], "activeIps": ips,
            "loginUsername": ssh_login_username(a["username"]) if a["protocol"] == "ssh" else a["username"],
            "host": _proto_host(a["protocol"]), "tlsPorts": _tls_ports(), "plainPorts": _plain_ports(),
            "connectionProfiles": cfg.get("profiles", []),
            "traffic": traffic,
            "usage": {"totalBytes": used, "limitBytes": limit_bytes, "remainingBytes": max(0, limit_bytes - used) if limit_bytes else 0}}



def accounts_config_public(a: dict) -> dict:
    profiles = connection_profiles(a)
    primary = profiles[1] if a["protocol"] == "ssh" and len(profiles) > 1 else (profiles[0] if profiles else {"link": "", "text": ""})
    summary = [p.get("text") or p.get("link", "") for p in profiles[:8]]
    return {"link": primary.get("link", ""), "text": "\n\n---\n\n".join(summary), "profiles": profiles}


@app.post("/accounts/{aid}/telegram")
def accounts_send_telegram(aid: str, user: str = Depends(require_auth)):
    a = accounts_get(aid, user)
    log("audit", "account.telegram", f"Telegram send queued for {a['username']}", actor=user, target=a["username"])
    return {"ok": True}


@app.post("/accounts/{aid}/rotate-token")
def accounts_rotate_token(aid: str, user: str = Depends(require_auth)):
    accounts_get(aid, user)
    token = _uuid.uuid4().hex
    return {"token": token}


# ---- Plans -----------------------------------------------------------------
@app.get("/plans")
def plans_list(_: Optional[str] = None):
    # Also readable by bot via internal token; we allow both auth methods.
    with db() as c:
        rows = c.execute("SELECT * FROM plans ORDER BY price_cents ASC").fetchall()
    return [row_to_plan(r) for r in rows]


@app.post("/plans")
def plans_create(inp: PlanIn, user: str = Depends(require_auth)):
    pid = "plan-" + _uuid.uuid4().hex[:8]
    with db() as c:
        c.execute("""INSERT INTO plans(id,name,mode,price_cents,duration_days,quota_gb,
                     speed_up_kbps,speed_dn_kbps,ip_limit,active) VALUES(?,?,?,?,?,?,?,?,?,?)""",
                  (pid, inp.name, inp.mode, inp.priceCents, inp.durationDays, inp.quotaGb,
                   inp.speedUpKbps, inp.speedDnKbps, inp.ipLimit, 1 if inp.active else 0))
        r = c.execute("SELECT * FROM plans WHERE id = ?", (pid,)).fetchone()
    log("audit", "plan.create", f"Created plan {inp.name}", actor=user)
    return row_to_plan(r)


@app.patch("/plans/{pid}")
def plans_update(pid: str, inp: PlanIn, user: str = Depends(require_auth)):
    with db() as c:
        c.execute("""UPDATE plans SET name=?,mode=?,price_cents=?,duration_days=?,quota_gb=?,
                     speed_up_kbps=?,speed_dn_kbps=?,ip_limit=?,active=? WHERE id=?""",
                  (inp.name, inp.mode, inp.priceCents, inp.durationDays, inp.quotaGb,
                   inp.speedUpKbps, inp.speedDnKbps, inp.ipLimit, 1 if inp.active else 0, pid))
        r = c.execute("SELECT * FROM plans WHERE id = ?", (pid,)).fetchone()
    if not r: raise HTTPException(404, "Not found")
    log("audit", "plan.update", f"Updated plan {inp.name}", actor=user)
    return row_to_plan(r)


@app.delete("/plans/{pid}")
def plans_delete(pid: str, user: str = Depends(require_auth)):
    with db() as c: c.execute("DELETE FROM plans WHERE id = ?", (pid,))
    log("audit", "plan.delete", f"Deleted plan {pid}", actor=user, level="warn")
    return {"ok": True}


# ---- Payments --------------------------------------------------------------
@app.get("/payments")
def payments_list(status: Optional[str] = None, _: str = Depends(require_auth)):
    with db() as c:
        if status:
            rows = c.execute("SELECT * FROM payments WHERE status = ? ORDER BY created_at DESC", (status,)).fetchall()
        else:
            rows = c.execute("SELECT * FROM payments ORDER BY created_at DESC").fetchall()
        plan_map = {p["id"]: p["name"] for p in c.execute("SELECT id,name FROM plans").fetchall()}
    return [{"id": r["id"], "telegramId": r["telegram_id"], "telegramName": r["telegram_name"],
             "planId": r["plan_id"], "planName": plan_map.get(r["plan_id"], r["plan_id"]),
             "amountCents": r["amount_cents"], "proofUrl": f"/api/payments/{r['id']}/proof",
             "createdAt": r["created_at"], "status": r["status"], "note": r["note"]} for r in rows]


@app.post("/payments/{pid}/approve")
def payments_approve(pid: str, user: str = Depends(require_auth)):
    with db() as c:
        p = c.execute("SELECT * FROM payments WHERE id = ?", (pid,)).fetchone()
        if not p: raise HTTPException(404, "Not found")
        plan = c.execute("SELECT * FROM plans WHERE id = ?", (p["plan_id"],)).fetchone()
        if not plan: raise HTTPException(404, "Plan not found")
        c.execute("UPDATE payments SET status = 'approved' WHERE id = ?", (pid,))
    # Provision default SSH account tied to this Telegram user
    username = f"tg{p['telegram_id']}"
    expires = (datetime.now(timezone.utc) + timedelta(days=plan["duration_days"] or 30)).isoformat()
    accounts_create(AccountIn(protocol="ssh", username=username, password=_uuid.uuid4().hex[:10],
                              expiresAt=expires, ipLimit=plan["ip_limit"],
                              speedUpKbps=plan["speed_up_kbps"], speedDnKbps=plan["speed_dn_kbps"],
                              quotaGb=plan["quota_gb"], telegramId=p["telegram_id"], planId=p["plan_id"]),
                    user)
    log("audit", "payment.approve", f"Approved payment {pid}", actor=user)
    return {"ok": True}


@app.post("/payments/{pid}/reject")
def payments_reject(pid: str, user: str = Depends(require_auth)):
    with db() as c: c.execute("UPDATE payments SET status = 'rejected' WHERE id = ?", (pid,))
    log("audit", "payment.reject", f"Rejected payment {pid}", actor=user, level="warn")
    return {"ok": True}


@app.post("/payments/{pid}/decide")
def payments_decide(pid: str, inp: DecisionIn, user: str = Depends(require_auth)):
    if inp.status == "approved":
        return payments_approve(pid, user)
    if inp.status == "rejected":
        return payments_reject(pid, user)
    if inp.status != "pending":
        raise HTTPException(400, "Invalid payment status")
    with db() as c:
        c.execute("UPDATE payments SET status = ?, note = ? WHERE id = ?", (inp.status, inp.reason, pid))
    log("audit", "payment.decide", f"Payment {pid} set to {inp.status}", actor=user)
    return {"ok": True}


# ---- Non-critical panel modules --------------------------------------------
@app.get("/connections")
def connections_list(_: str = Depends(require_auth)):
    return []


@app.post("/connections/{cid}/kick")
def connections_kick(cid: str, user: str = Depends(require_auth)):
    log("audit", "connection.kick", f"Kick requested for {cid}", actor=user)
    return {"ok": True}


@app.get("/backups")
def backups_list(_: str = Depends(require_auth)):
    backups = []
    for p in sorted(Path("/root").glob("autoscript-backup-*.tar.gz"), reverse=True):
        st = p.stat()
        backups.append({"id": p.name, "createdAt": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
                        "sizeBytes": st.st_size, "kind": "manual", "destination": "local", "status": "ready"})
    return backups


@app.post("/backups")
def backups_create(inp: BackupIn, user: str = Depends(require_auth)):
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out = f"/root/autoscript-backup-{ts}.tar.gz"
    subprocess.run(["tar", "-czf", out, "/etc/autoscript", "/usr/local/etc/xray"], capture_output=True, text=True, check=False)
    log("audit", "backup.create", f"Backup created at {out}", actor=user)
    return {"id": Path(out).name, "createdAt": datetime.now(timezone.utc).isoformat(),
            "sizeBytes": Path(out).stat().st_size if Path(out).exists() else 0,
            "kind": "manual", "destination": inp.destination, "status": "ready"}


@app.post("/backups/{bid}/restore")
def backups_restore(bid: str, user: str = Depends(require_auth)):
    log("audit", "backup.restore", f"Restore requested for {bid}", actor=user, level="warn")
    return {"ok": True}


@app.delete("/backups/{bid}")
def backups_delete(bid: str, user: str = Depends(require_auth)):
    p = Path("/root") / bid
    if p.name.startswith("autoscript-backup-") and p.suffixes[-2:] == [".tar", ".gz"] and p.exists():
        p.unlink()
    log("audit", "backup.delete", f"Deleted backup {bid}", actor=user, level="warn")
    return {"ok": True}


@app.get("/alerts")
def alerts_list(_: str = Depends(require_auth)):
    alerts = []
    for svc in ("xray", "autoscript-ssh-ws", "nginx"):
        if run(["systemctl", "is-active", svc]).stdout.strip() != "active":
            alerts.append({"id": svc, "ts": datetime.now(timezone.utc).isoformat(), "level": "critical",
                           "source": svc, "message": f"{svc} is not running", "acknowledged": False})
    return alerts


@app.post("/alerts/{aid}/ack")
def alerts_ack(aid: str, user: str = Depends(require_auth)):
    log("audit", "alert.ack", f"Alert acknowledged {aid}", actor=user)
    return {"ok": True}


@app.get("/wallet")
def wallet_list(_: str = Depends(require_auth)):
    return []


@app.get("/wallet/balance")
def wallet_balance(_: str = Depends(require_auth)):
    return {"balanceCents": 0}


@app.post("/wallet/credit")
def wallet_credit(inp: CreditIn, user: str = Depends(require_auth)):
    log("audit", "wallet.credit", f"Wallet credit {inp.amountCents}: {inp.reason}", actor=user)
    return {"ok": True}


@app.get("/invoices")
def invoices_list(_: str = Depends(require_auth)):
    return []


@app.post("/invoices/{iid}/send")
def invoices_send(iid: str, user: str = Depends(require_auth)):
    log("audit", "invoice.send", f"Invoice send queued for {iid}", actor=user)
    return {"ok": True}


# ---- Bot (settings + internal endpoints) -----------------------------------
BOT_KEYS = ["enabled", "token", "adminChatId", "welcomeText", "autoDeleteMinutes",
            "paymentInstructions", "paymentQrUrl"]


def bot_settings_read() -> dict:
    s = {k: kv_get(f"bot.{k}", "") for k in BOT_KEYS}
    s["enabled"] = s["enabled"] == "1"
    s["autoDeleteMinutes"] = int(s["autoDeleteMinutes"] or 10)
    r = run(["systemctl", "is-active", "autoscript-bot"])
    s["running"] = r.stdout.strip() == "active"
    return s


@app.get("/bot")
def bot_get(request: Request, x_internal_token: str = Header(default="")):
    if not (INTERNAL_TOKEN and x_internal_token == INTERNAL_TOKEN):
        require_auth(request)
    return bot_settings_read()


@app.patch("/bot")
def bot_save(inp: BotIn, user: str = Depends(require_auth)):
    for k in BOT_KEYS:
        v = getattr(inp, k, None)
        if v is None: continue
        if k == "enabled": v = "1" if v else "0"
        kv_set(f"bot.{k}", str(v))
    log("audit", "bot.update", "Bot settings updated", actor=user)
    subprocess.Popen(["systemctl", "restart", "autoscript-bot"])
    return bot_settings_read()


@app.post("/bot/restart")
def bot_restart(user: str = Depends(require_auth)):
    subprocess.Popen(["systemctl", "restart", "autoscript-bot"])
    log("audit", "bot.restart", "Bot restart requested", actor=user); return {"ok": True}


@app.get("/bot/accounts/{tg_id}")
def bot_accounts(tg_id: str, _: None = Depends(require_internal)):
    with db() as c:
        rows = c.execute("SELECT * FROM accounts WHERE telegram_id = ? ORDER BY created_at DESC", (tg_id,)).fetchall()
    return [row_to_account(r) for r in rows]


@app.post("/bot/payments")
def bot_payment_create(inp: PaymentBotIn, _: None = Depends(require_internal)):
    with db() as c:
        plan = c.execute("SELECT * FROM plans WHERE id = ?", (inp.planId,)).fetchone()
        pid = "pay-" + _uuid.uuid4().hex[:8]
        proof_path = str(UPLOAD_DIR / f"{pid}.jpg")  # bot uploads file separately
        c.execute("""INSERT INTO payments(id,telegram_id,telegram_name,plan_id,amount_cents,proof_path,
                     created_at,status) VALUES(?,?,?,?,?,?,?,?)""",
                  (pid, inp.telegramId, inp.telegramName, inp.planId,
                   plan["price_cents"] if plan else 0, proof_path,
                   datetime.now(timezone.utc).isoformat(), "pending"))
    log("audit", "payment.create", f"New payment from {inp.telegramName}", actor=inp.telegramName)
    return {"ok": True, "id": pid}


# ---- Settings --------------------------------------------------------------
@app.get("/settings")
def settings_get(_: str = Depends(require_auth)):
    cf_tls = {443, 2053, 2083, 2087, 2096, 8443}
    cf_plain = {80, 8080, 8880, 2052, 2082, 2086, 2095}
    tls_ports = _port_list(kv_get("panel.tlsPorts", "443,2053,2083,2087,2096,8443"), [443,2053,2083,2087,2096,8443], cf_tls)
    plain_ports = _port_list(kv_get("panel.plainPorts", "80,8080,8880,2052,2082,2086,2095"), [80,8080,8880,2052,2082,2086,2095], cf_plain)
    endpoints: dict[str, dict[str, Any]] = {}
    for proto in ("ssh", "vmess", "vless", "trojan"):
        host = kv_get(f"hosts.{proto}", "")
        port = kv_get(f"ports.{proto}", "")
        ep: dict[str, Any] = {}
        if host:
            ep["host"] = host
        parsed_port = _safe_int(port, 0)
        if 1 <= parsed_port <= 65535:
            ep["port"] = parsed_port
        endpoints[proto] = ep
    panel_port = kv_get("panel.port", str(PANEL_PORT))
    return {
        "domain": kv_get("panel.domain", PANEL_DOMAIN),
        "port": _safe_int(panel_port, PANEL_PORT),
        "tlsMode": kv_get("panel.tlsMode", "single"),
        "dnsProvider": kv_get("panel.dnsProvider", ""),
        "rootDomain": kv_get("panel.rootDomain", ""),
        "dbPath": DB_PATH,
        "repoUrl": kv_get("panel.repoUrl", REPO_URL),
        "tlsPorts": tls_ports,
        "plainPorts": plain_ports,
        "endpoints": endpoints,
        "sshBanner": kv_get("ssh.banner", DEFAULT_SSH_BANNER),
        "sshBannerVariables": BANNER_VARIABLES,
        "autoSuspend": kv_get("panel.autoSuspend", "1") == "1",
        "webhookUrl": kv_get("webhook.url", ""),
        "webhookSecret": kv_get("webhook.secret", ""),
    }



@app.patch("/settings")
def settings_save(inp: SettingsIn, user: str = Depends(require_auth)):
    changed = {}
    for k in ("domain", "port", "tlsMode", "dnsProvider", "rootDomain", "repoUrl"):
        v = getattr(inp, k)
        if v is not None:
            if k == "domain":
                update_env_value("PANEL_DOMAIN", str(v).strip())
            elif k == "port":
                p = _safe_int(v, 0)
                if p < 1 or p > 65535:
                    raise HTTPException(400, "Invalid panel port")
                update_env_value("PANEL_PORT", str(p))
                v = p
            elif k == "repoUrl":
                update_env_value("REPO_URL", str(v).strip())
            kv_set(f"panel.{k}", str(v).strip() if isinstance(v, str) else str(v)); changed[k] = v
    cf_tls = {443, 2053, 2083, 2087, 2096, 8443}
    cf_plain = {80, 8080, 8880, 2052, 2082, 2086, 2095}
    if inp.tlsPorts is not None:
        ports = sorted({p for raw in inp.tlsPorts for p in [_safe_int(raw, 0)] if p in cf_tls})
        if not ports:
            raise HTTPException(400, "At least one TLS port is required")
        kv_set("panel.tlsPorts", ",".join(map(str, ports))); changed["tlsPorts"] = ports
    if inp.plainPorts is not None:
        ports = sorted({p for raw in inp.plainPorts for p in [_safe_int(raw, 0)] if p in cf_plain})
        kv_set("panel.plainPorts", ",".join(map(str, ports))); changed["plainPorts"] = ports
    if inp.endpoints is not None:
        for proto in ("ssh", "vmess", "vless", "trojan"):
            ep = inp.endpoints.get(proto) or {}
            host = str(ep.get("host") or "").strip()
            port = ep.get("port")
            kv_set(f"hosts.{proto}", host)
            if port in (None, ""):
                kv_set(f"ports.{proto}", "")
            else:
                p = _safe_int(port, 0)
                if p < 1 or p > 65535:
                    raise HTTPException(400, f"Invalid {proto} port")
                kv_set(f"ports.{proto}", str(p))
        changed["endpoints"] = inp.endpoints
    if inp.sshBanner is not None:
        kv_set("ssh.banner", inp.sshBanner)
        write_pre_auth_banner()
        changed["sshBanner"] = True
    if inp.autoSuspend is not None:
        kv_set("panel.autoSuspend", "1" if inp.autoSuspend else "0")
        changed["autoSuspend"] = inp.autoSuspend
    if inp.webhookUrl is not None:
        kv_set("webhook.url", inp.webhookUrl.strip()); changed["webhookUrl"] = True
    if inp.webhookSecret is not None:
        kv_set("webhook.secret", inp.webhookSecret.strip()); changed["webhookSecret"] = True
    apply = Path(INSTALL_ROOT) / "backend" / "scripts" / "apply_settings.sh"
    if apply.exists():
        subprocess.Popen(["bash", str(apply)])
    log("audit", "settings.update", f"Settings updated: {list(changed)}", actor=user)
    if any(k in changed for k in ("domain", "port")):
        subprocess.Popen(["bash", "-lc", "nohup bash -c 'sleep 2; systemctl restart autoscript-agent' >/dev/null 2>&1 &"])
    return settings_get(user)


@app.get("/settings/banner/preview")
def settings_banner_preview(_: str = Depends(require_auth)):
    """Render the current banner template with server-side variables filled in."""
    return {"html": render_banner(kv_get("ssh.banner", DEFAULT_SSH_BANNER)),
            "variables": BANNER_VARIABLES}


@app.get("/internal/motd")
def internal_motd(username: str, x_internal_token: str = Header(default="")):
    """Called by the SSH login shell (grvpn-motd) to render the per-user banner."""
    if not INTERNAL_TOKEN or x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden")
    # Strip the 'grvpn-' prefix if the SSH system username is passed through.
    panel_user = username[6:] if username.startswith("grvpn-") else username
    with db() as c:
        r = c.execute("SELECT * FROM accounts WHERE username = ? AND protocol = 'ssh'", (panel_user,)).fetchone()
    if not r:
        return {"html": render_banner(kv_get("ssh.banner", DEFAULT_SSH_BANNER))}
    a = row_to_account(r)
    try:
        exp = datetime.fromisoformat(a["expiresAt"].replace("Z", "+00:00"))
        days_left = max(0, (exp - datetime.now(timezone.utc)).days)
        exp_str = exp.strftime("%Y-%m-%d")
    except Exception:
        days_left = 0; exp_str = a.get("expiresAt", "")
    quota = int(a.get("quotaGb") or 0)
    used_gb = round(int(a.get("usedBytes") or 0) / (1024 ** 3), 2)
    remaining = max(0, quota - used_gb) if quota else 0
    extra = {
        "{{USERNAME}}":     a["username"],
        "{{IP_LIMIT}}":     str(a.get("ipLimit") or 0),
        "{{DAYS_LEFT}}":    str(days_left),
        "{{EXPIRES}}":      exp_str,
        "{{USED_GB}}":      f"{used_gb:.2f}",
        "{{QUOTA_GB}}":     "unlimited" if not quota else str(quota),
        "{{REMAINING_GB}}": "unlimited" if not quota else f"{remaining:.2f}",
        "{{STATUS}}":       a.get("status", "active"),
    }
    return {"html": render_banner(kv_get("ssh.banner", DEFAULT_SSH_BANNER), extra)}



@app.post("/settings/password")
def settings_password(inp: PasswordIn, user: str = Depends(require_auth)):
    global ADMIN_HASH
    if len(inp.next) < 6:
        raise HTTPException(400, "New password must be at least 6 characters")
    if not verify_admin_password(inp.current):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is wrong")
    ADMIN_HASH = argon2.hash(inp.next)
    update_env_value("ADMIN_HASH", ADMIN_HASH)
    kv_set("admin.hash", ADMIN_HASH)
    log("audit", "settings.password", "Admin password changed", actor=user, level="warn")
    return {"ok": True}


# ---- Logs ------------------------------------------------------------------
@app.get("/logs")
def logs_list(type: Optional[str] = None, limit: int = 200, _: str = Depends(require_auth)):
    with db() as c:
        if type:
            rows = c.execute("SELECT * FROM logs WHERE type = ? ORDER BY id DESC LIMIT ?", (type, limit)).fetchall()
        else:
            rows = c.execute("SELECT * FROM logs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [{"id": str(r["id"]), "ts": r["ts"], "type": r["type"], "level": r["level"],
             "actor": r["actor"], "action": r["action"], "target": r["target"],
             "message": r["message"]} for r in rows]


# ---- Reverse proxy to the TanStack Start Node server (registered last so
# ---- /api/* and other API routes take priority).
try:
    import os as _os
    import httpx as _httpx
    from fastapi import Request as _Req
    from fastapi.responses import Response as _Resp, PlainTextResponse as _PT
    from starlette.websockets import WebSocket as _WS

    _WEB_PORT = _os.environ.get("WEB_INTERNAL_PORT", "").strip()
    _WEB_BASE = f"http://127.0.0.1:{_WEB_PORT}" if _WEB_PORT else ""
    _HOP = {"connection","keep-alive","proxy-authenticate","proxy-authorization",
            "te","trailers","transfer-encoding","upgrade","content-encoding","content-length"}
    _client = _httpx.AsyncClient(base_url=_WEB_BASE, timeout=60.0) if _WEB_BASE else None

    @app.api_route("/{full_path:path}", methods=["GET","POST","PUT","PATCH","DELETE","OPTIONS","HEAD"], include_in_schema=False)
    async def _spa_proxy(full_path: str, request: _Req):
        if not _client:
            return _PT("Web server not configured. Run: autoscript update\n", status_code=503)
        url = "/" + full_path
        if request.url.query:
            url += "?" + request.url.query
        headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP}
        headers["x-forwarded-proto"] = "https"
        headers["x-forwarded-host"] = request.headers.get("host", "")
        try:
            body = await request.body()
            r = await _client.request(request.method, url, headers=headers, content=body)
        except Exception as _e:
            return _PT(f"Web server unreachable: {_e}\nTry: systemctl restart autoscript-web\n", status_code=502)
        out_headers = [(k, v) for k, v in r.headers.items() if k.lower() not in _HOP]
        return _Resp(content=r.content, status_code=r.status_code, headers=dict(out_headers),
                     media_type=r.headers.get("content-type"))
except Exception as _e:
    print(f"web-proxy-init-failed: {_e}", flush=True)


