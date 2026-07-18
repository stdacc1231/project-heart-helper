"""
Autoscript Panel — FastAPI agent.

Runs on the VPS behind Nginx.  The web UI talks to `/api/*` and this app
shells out to the existing bash scripts under ../scripts so the protocol
logic (xray configs, useradd, tc, etc.) does not have to be rewritten.
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import subprocess
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

import psutil
from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.hash import argon2
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Config (populated from /etc/autoscript/agent.env via systemd EnvironmentFile)
# ---------------------------------------------------------------------------
PANEL_DOMAIN = os.environ.get("PANEL_DOMAIN", "panel.local")
DB_PATH = os.environ.get("DB_PATH", "/etc/autoscript/db.sqlite")
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_HASH = os.environ.get("ADMIN_HASH", "")
REPO_URL = os.environ.get("REPO_URL", "")
INSTALL_ROOT = os.environ.get("INSTALL_ROOT", "/opt/autoscript")
SCRIPTS = Path(INSTALL_ROOT) / "backend" / "scripts"

JWT_ALG = "HS256"
JWT_TTL = 60 * 60 * 24  # 1 day

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
    speed_kbps    INTEGER NOT NULL DEFAULT 0,
    quota_gb      INTEGER NOT NULL DEFAULT 0,
    used_bytes    INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'active'
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
"""


@contextmanager
def db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        con.executescript(SCHEMA)
        yield con
        con.commit()
    finally:
        con.close()


def log(kind: str, action: str, message: str, *, actor="system", target=None, level="info"):
    with db() as c:
        c.execute(
            "INSERT INTO logs(ts,type,level,actor,action,target,message) VALUES(?,?,?,?,?,?,?)",
            (datetime.now(timezone.utc).isoformat(), kind, level, actor, action, target, message),
        )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
bearer = HTTPBearer(auto_error=False)


def make_token(sub: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": sub, "iat": now, "exp": now + timedelta(seconds=JWT_TTL)},
                      JWT_SECRET, algorithm=JWT_ALG)


def require_auth(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> str:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing token")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        return payload["sub"]
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bad token")


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
    speedLimitKbps: int = 0
    quotaGb: int = 0


class AccountPatch(BaseModel):
    password: Optional[str] = None
    expiresAt: Optional[str] = None
    ipLimit: Optional[int] = None
    speedLimitKbps: Optional[int] = None
    quotaGb: Optional[int] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def run(cmd: list[str], check=True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def row_to_account(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "protocol": r["protocol"],
        "username": r["username"],
        "password": r["password"],
        "uuid": r["uuid"],
        "createdAt": r["created_at"],
        "expiresAt": r["expires_at"],
        "ipLimit": r["ip_limit"],
        "speedLimitKbps": r["speed_kbps"],
        "quotaGb": r["quota_gb"],
        "usedBytes": r["used_bytes"],
        "online": 0,  # populated from xray-stats / who
        "status": r["status"],
    }


def apply_speed_limit(username: str, kbps: int) -> None:
    """Delegate to scripts/tc_limit.sh (safe no-op if the script is missing)."""
    script = SCRIPTS / "tc_limit.sh"
    if script.exists():
        run(["bash", str(script), username, str(kbps)], check=False)


def provision_account(a: dict) -> None:
    script = SCRIPTS / f"provision_{a['protocol']}.sh"
    if script.exists():
        env = {**os.environ, "USERNAME": a["username"], "PASSWORD": a.get("password") or "",
               "UUID": a.get("uuid") or "", "EXPIRES": a["expiresAt"],
               "IP_LIMIT": str(a["ipLimit"]), "QUOTA_GB": str(a["quotaGb"])}
        subprocess.run(["bash", str(script)], env=env, check=False)
    apply_speed_limit(a["username"], a["speedLimitKbps"])


def revoke_account(a: dict) -> None:
    script = SCRIPTS / f"revoke_{a['protocol']}.sh"
    if script.exists():
        subprocess.run(["bash", str(script), a["username"]], check=False)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Autoscript Panel Agent", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"], allow_credentials=True)


# ---- Auth ------------------------------------------------------------------
@app.post("/auth/login")
def auth_login(inp: LoginIn, response: Response):
    ok = False
    if inp.username == ADMIN_USER and ADMIN_HASH:
        try:
            # Support both argon2 hashes and legacy crypt SHA512 hashes.
            if ADMIN_HASH.startswith("$argon2"):
                ok = argon2.verify(inp.password, ADMIN_HASH)
            else:
                import crypt as _c
                ok = _c.crypt(inp.password, ADMIN_HASH) == ADMIN_HASH
        except Exception:
            ok = False
    if not ok:
        log("auth", "auth.login.fail", f"Failed login for {inp.username}", level="warn", actor=inp.username)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    token = make_token(inp.username)
    response.set_cookie("token", token, httponly=True, secure=True, samesite="lax", max_age=JWT_TTL)
    log("auth", "auth.login", f"{inp.username} signed in", actor=inp.username)
    return {"ok": True, "token": token}


@app.post("/auth/logout")
def auth_logout(response: Response):
    response.delete_cookie("token")
    return {"ok": True}


@app.get("/auth/me")
def auth_me(user: str = Depends(require_auth)):
    return {"username": user}


# ---- System ----------------------------------------------------------------
@app.get("/system/status")
def system_status(_: str = Depends(require_auth)):
    vm = psutil.virtual_memory()
    du = psutil.disk_usage("/")
    net1 = psutil.net_io_counters(); time.sleep(0.3); net2 = psutil.net_io_counters()
    services = []
    for svc in ("xray", "ssh", "autoscript-ssh-ws", "nginx", "autoscript-agent"):
        r = subprocess.run(["systemctl", "is-active", svc], capture_output=True, text=True)
        services.append({"name": svc, "running": r.stdout.strip() == "active"})
    return {
        "uptimeSeconds": int(time.time() - psutil.boot_time()),
        "cpuPercent": psutil.cpu_percent(interval=0.2),
        "memoryPercent": vm.percent,
        "memoryUsedMb": vm.used // 1024 // 1024,
        "memoryTotalMb": vm.total // 1024 // 1024,
        "diskPercent": du.percent,
        "diskUsedGb": round(du.used / 1024**3, 1),
        "diskTotalGb": round(du.total / 1024**3, 1),
        "netRxMbps": round((net2.bytes_recv - net1.bytes_recv) * 8 / 0.3 / 1_000_000, 2),
        "netTxMbps": round((net2.bytes_sent - net1.bytes_sent) * 8 / 0.3 / 1_000_000, 2),
        "services": services,
        "hostname": os.uname().nodename,
        "os": Path("/etc/os-release").read_text().split("PRETTY_NAME=")[1].split("\n")[0].strip('"'),
        "kernel": os.uname().release,
        "ipv4": subprocess.run(["hostname", "-I"], capture_output=True, text=True).stdout.split()[0],
    }


@app.get("/system/version")
def system_version(_: str = Depends(require_auth)):
    try:
        cur = subprocess.check_output(["git", "-C", INSTALL_ROOT, "rev-parse", "--short", "HEAD"], text=True).strip()
        cur_date = subprocess.check_output(["git", "-C", INSTALL_ROOT, "log", "-1", "--format=%cI"], text=True).strip()
        subprocess.run(["git", "-C", INSTALL_ROOT, "fetch", "--quiet"], check=False)
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
    subprocess.run(["git", "-C", INSTALL_ROOT, "fetch", "--all"], check=True)
    subprocess.run(["git", "-C", INSTALL_ROOT, "reset", "--hard", "origin/main"], check=True)
    migrate = Path(INSTALL_ROOT) / "backend" / "scripts" / "migrate.sh"
    if migrate.exists():
        subprocess.run(["bash", str(migrate)], check=False)
    commit = subprocess.check_output(
        ["git", "-C", INSTALL_ROOT, "rev-parse", "--short", "HEAD"], text=True).strip()
    log("audit", "system.update", f"Updated to {commit}", actor=user)
    # Restart in background so the response returns first.
    subprocess.Popen(["systemctl", "restart", "autoscript-agent", "nginx"])
    return {"ok": True, "commit": commit}


# ---- Accounts --------------------------------------------------------------
@app.get("/accounts")
def accounts_list(protocol: Optional[str] = None, _: str = Depends(require_auth)):
    with db() as c:
        q = "SELECT * FROM accounts"
        args: tuple = ()
        if protocol:
            q += " WHERE protocol = ?"
            args = (protocol,)
        q += " ORDER BY created_at DESC"
        rows = c.execute(q, args).fetchall()
    return [row_to_account(r) for r in rows]


@app.get("/accounts/{aid}")
def accounts_get(aid: str, _: str = Depends(require_auth)):
    with db() as c:
        r = c.execute("SELECT * FROM accounts WHERE id = ?", (aid,)).fetchone()
    if not r:
        raise HTTPException(404, "Not found")
    return row_to_account(r)


@app.post("/accounts")
def accounts_create(inp: AccountIn, user: str = Depends(require_auth)):
    aid = f"{inp.protocol}-{uuid.uuid4().hex[:8]}"
    account = {
        "id": aid, "protocol": inp.protocol, "username": inp.username,
        "password": inp.password, "uuid": None if inp.protocol == "ssh" else str(uuid.uuid4()),
        "createdAt": datetime.now(timezone.utc).isoformat(), "expiresAt": inp.expiresAt,
        "ipLimit": inp.ipLimit, "speedLimitKbps": inp.speedLimitKbps, "quotaGb": inp.quotaGb,
    }
    with db() as c:
        c.execute("""INSERT INTO accounts(id,protocol,username,password,uuid,created_at,
                     expires_at,ip_limit,speed_kbps,quota_gb) VALUES(?,?,?,?,?,?,?,?,?,?)""",
                  (aid, inp.protocol, inp.username, inp.password, account["uuid"],
                   account["createdAt"], inp.expiresAt, inp.ipLimit, inp.speedLimitKbps, inp.quotaGb))
    provision_account(account)
    log("audit", "account.create", f"Created {inp.protocol} account {inp.username}",
        actor=user, target=inp.username)
    return row_to_account_dict(account)


def row_to_account_dict(a: dict) -> dict:
    return {**a, "usedBytes": 0, "online": 0, "status": "active"}


@app.patch("/accounts/{aid}")
def accounts_update(aid: str, patch: AccountPatch, user: str = Depends(require_auth)):
    with db() as c:
        r = c.execute("SELECT * FROM accounts WHERE id = ?", (aid,)).fetchone()
        if not r:
            raise HTTPException(404, "Not found")
        fields, args = [], []
        if patch.password is not None:  fields.append("password = ?");    args.append(patch.password)
        if patch.expiresAt is not None: fields.append("expires_at = ?");  args.append(patch.expiresAt)
        if patch.ipLimit is not None:   fields.append("ip_limit = ?");    args.append(patch.ipLimit)
        if patch.speedLimitKbps is not None: fields.append("speed_kbps = ?"); args.append(patch.speedLimitKbps)
        if patch.quotaGb is not None:   fields.append("quota_gb = ?");    args.append(patch.quotaGb)
        if fields:
            c.execute(f"UPDATE accounts SET {', '.join(fields)} WHERE id = ?", (*args, aid))
        r = c.execute("SELECT * FROM accounts WHERE id = ?", (aid,)).fetchone()
    if patch.speedLimitKbps is not None:
        apply_speed_limit(r["username"], patch.speedLimitKbps)
    log("audit", "account.update", f"Updated {r['protocol']} account {r['username']}",
        actor=user, target=r["username"])
    return row_to_account(r)


@app.delete("/accounts/{aid}")
def accounts_delete(aid: str, user: str = Depends(require_auth)):
    with db() as c:
        r = c.execute("SELECT * FROM accounts WHERE id = ?", (aid,)).fetchone()
        if not r:
            raise HTTPException(404, "Not found")
        c.execute("DELETE FROM accounts WHERE id = ?", (aid,))
    revoke_account(row_to_account(r))
    log("audit", "account.delete", f"Deleted {r['protocol']} account {r['username']}",
        actor=user, target=r["username"], level="warn")
    return {"ok": True}


@app.get("/accounts/{aid}/config")
def accounts_config(aid: str, _: str = Depends(require_auth)):
    a = accounts_get(aid, _)
    host = PANEL_DOMAIN
    if a["protocol"] == "ssh":
        return {
            "link": f"ssh://{a['username']}:{a['password']}@{host}:22",
            "text": f"Host: {host}\nPort: 22 (SSH), 443 (WebSocket path /)\n"
                    f"User: {a['username']}\nPassword: {a['password']}",
        }
    if a["protocol"] == "vmess":
        cfg = {"v": "2", "ps": a["username"], "add": host, "port": 443, "id": a["uuid"],
               "aid": 0, "net": "ws", "type": "none", "host": host, "path": "/vmess", "tls": "tls"}
        import base64
        link = "vmess://" + base64.b64encode(json.dumps(cfg).encode()).decode()
        return {"link": link, "text": json.dumps(cfg, indent=2)}
    if a["protocol"] == "vless":
        return {"link": f"vless://{a['uuid']}@{host}:443?type=ws&security=tls&path=%2Fvless#{a['username']}", "text": ""}
    return {"link": f"trojan://{a['uuid']}@{host}:443?type=ws&security=tls&path=%2Ftrojan#{a['username']}", "text": ""}


# ---- Logs ------------------------------------------------------------------
@app.get("/logs")
def logs_list(type: Optional[str] = None, limit: int = 200, _: str = Depends(require_auth)):
    with db() as c:
        q = "SELECT * FROM logs"; args: tuple = ()
        if type:
            q += " WHERE type = ?"; args = (type,)
        q += " ORDER BY id DESC LIMIT ?"; args = (*args, limit)
        rows = c.execute(q, args).fetchall()
    return [{"id": str(r["id"]), "ts": r["ts"], "type": r["type"], "level": r["level"],
             "actor": r["actor"], "action": r["action"], "target": r["target"],
             "message": r["message"]} for r in rows]
