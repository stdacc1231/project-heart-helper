"""
Autoscript Panel — FastAPI agent.

Runs on the VPS behind Nginx.  The web UI talks to /api/*.  The Telegram bot
runs as a sibling service and talks to /bot/* on the internal port with a
shared X-Internal-Token header so business rules stay in one place.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import sqlite3
import subprocess
import time
import uuid as _uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

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


class PasswordIn(BaseModel):
    current: str
    next: str


class PaymentBotIn(BaseModel):
    telegramId: str
    telegramName: str
    planId: str
    fileId: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def run(cmd: list[str], check=False) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


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
               "UUID": a.get("uuid") or "", "EXPIRES": a["expiresAt"],
               "IP_LIMIT": str(a["ipLimit"]), "QUOTA_GB": str(a["quotaGb"])}
        r = subprocess.run(["bash", str(script)], env=env, capture_output=True, text=True, check=False)
        if r.returncode != 0:
            raise HTTPException(500, (r.stderr or r.stdout or "Provisioning failed").strip()[:500])
    apply_speed_limit(a["username"], a["speedUpKbps"], a["speedDnKbps"])


def revoke_account(a: dict) -> None:
    script = SCRIPTS / f"revoke_{a['protocol']}.sh"
    if script.exists():
        subprocess.run(["bash", str(script), a["username"]], check=False)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Autoscript Panel Agent", version="1.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"], allow_credentials=True)


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
    if range == "1h":   since_min = 60;   bucket_sec = 60
    elif range == "7d": since_min = 60*24*7; bucket_sec = 3600*2
    else:               since_min = 60*24; bucket_sec = 3600
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


# ---- Accounts --------------------------------------------------------------
@app.get("/accounts")
def accounts_list(protocol: Optional[str] = None, _: str = Depends(require_auth)):
    with db() as c:
        q = "SELECT * FROM accounts"; args: tuple = ()
        if protocol: q += " WHERE protocol = ?"; args = (protocol,)
        q += " ORDER BY created_at DESC"
        rows = c.execute(q, args).fetchall()
    return [row_to_account(r) for r in rows]


@app.get("/accounts/{aid}")
def accounts_get(aid: str, _: str = Depends(require_auth)):
    with db() as c:
        r = c.execute("SELECT * FROM accounts WHERE id = ?", (aid,)).fetchone()
    if not r: raise HTTPException(404, "Not found")
    return row_to_account(r)


@app.post("/accounts")
def accounts_create(inp: AccountIn, user: str = Depends(require_auth)):
    proto = inp.protocol.lower().strip()
    if proto not in ("ssh", "vmess", "vless", "trojan"):
        raise HTTPException(400, "Unsupported protocol")
    username = inp.username.strip()
    if not username:
        raise HTTPException(400, "Username is required")
    try:
        datetime.fromisoformat(inp.expiresAt.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "Invalid expiry date")
    password = inp.password or (_uuid.uuid4().hex[:12] if proto == "ssh" else None)
    aid = f"{inp.protocol}-{_uuid.uuid4().hex[:8]}"
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
    try:
        provision_account(a)
    except HTTPException:
        with db() as c:
            c.execute("DELETE FROM accounts WHERE id = ?", (aid,))
        raise
    log("audit", "account.create", f"Created {proto} account {username}",
        actor=user, target=username)
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
    if patch.speedUpKbps is not None or patch.speedDnKbps is not None:
        apply_speed_limit(r["username"], r["speed_up_kbps"], r["speed_dn_kbps"])
    log("audit", "account.update", f"Updated {r['protocol']} account {r['username']}",
        actor=user, target=r["username"])
    return row_to_account(r)


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
    host = PANEL_DOMAIN
    if a["protocol"] == "ssh":
        return {"link": f"ssh://{a['username']}:{a['password']}@{host}:22",
                "text": f"Host: {host}\nPort: 22 (SSH), {PANEL_PORT} (WebSocket path /)\n"
                        f"User: {a['username']}\nPassword: {a['password']}"}
    if a["protocol"] == "vmess":
        cfg = {"v":"2","ps":a["username"],"add":host,"port":PANEL_PORT,"id":a["uuid"],
               "aid":0,"net":"ws","type":"none","host":host,"path":"/vmess","tls":"tls"}
        return {"link": "vmess://" + base64.b64encode(json.dumps(cfg).encode()).decode(),
                "text": json.dumps(cfg, indent=2)}
    if a["protocol"] == "vless":
        return {"link": f"vless://{a['uuid']}@{host}:{PANEL_PORT}?type=ws&security=tls&path=%2Fvless#{a['username']}", "text": ""}
    return {"link": f"trojan://{a['uuid']}@{host}:{PANEL_PORT}?type=ws&security=tls&path=%2Ftrojan#{a['username']}", "text": ""}


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
    return {
        "domain": PANEL_DOMAIN,
        "port": PANEL_PORT,
        "tlsMode": kv_get("panel.tlsMode", "single"),
        "dnsProvider": kv_get("panel.dnsProvider", ""),
        "rootDomain": kv_get("panel.rootDomain", ""),
        "dbPath": DB_PATH,
        "repoUrl": REPO_URL,
    }


@app.patch("/settings")
def settings_save(inp: SettingsIn, user: str = Depends(require_auth)):
    changed = {}
    for k in ("domain", "port", "tlsMode", "dnsProvider", "rootDomain", "repoUrl"):
        v = getattr(inp, k)
        if v is not None: kv_set(f"panel.{k}", str(v)); changed[k] = v
    apply = Path(INSTALL_ROOT) / "backend" / "scripts" / "apply_settings.sh"
    if apply.exists():
        subprocess.Popen(["bash", str(apply)])
    log("audit", "settings.update", f"Settings updated: {list(changed)}", actor=user)
    return settings_get(user)


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


