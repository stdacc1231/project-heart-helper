# Autoscript Web UI — Migration Plan

## Goal
Retire the interactive bash menus. Keep every install/runtime script in Python/bash on the VPS. Drive everything from a clean, modern web panel served from the same VPS, protected by a domain + TLS you generate at install time.

## Architecture

```text
Browser (Web UI, TanStack Start)
        │  HTTPS (your domain)
        ▼
Nginx  ──►  /            → Web UI static + SSR
           /api/*        → Python Agent (FastAPI, localhost:8088)
           /ws           → SSH-over-WebSocket (HTTP/1.1 Upgrade, fixed)
           /vmess-ws, /vless-ws, /trojan-ws → xray/backend
        │
        ▼
Python Agent (FastAPI + Uvicorn, systemd)
  - Wraps existing bash scripts (no rewrite of protocol logic)
  - SQLite DB at configurable path (default /etc/autoscript/db.sqlite)
  - Auth: admin login (argon2), JWT session
  - Self-update: `git pull` from your GitHub repo + `systemctl restart`
```

Backend logic stays as-is. The agent is a thin API layer that shells out to the existing scripts and reads the same account files, then normalizes results into JSON.

## Scope of Phase 1 (this milestone)

### 1. Installer rewrite (bash)
- Full **English** copy (translate all Indonesian strings).
- On install prompt for:
  1. **Panel domain** (e.g. `panel.example.com`)
  2. **Certificate mode**: `1) Single domain` or `2) Wildcard` (DNS-01 via acme.sh)
  3. Admin username + password for the web panel
  4. DB path (default `/etc/autoscript/db.sqlite`)
- Issue TLS once with acme.sh; **reuse the same cert** for Nginx panel vhost AND for xray (VMess/VLESS/Trojan TLS) — single fullchain, single key path, symlinked.
- Install + enable: `autoscript-agent.service`, Nginx vhost, xray, ssh-ws, cron for cert renew.
- **Remove entirely**: Cloudflare WARP install, Cloudflare Zero Trust tunnel setup, all related menu items, configs, and systemd units. Purge on upgrade.

### 2. SSH WebSocket path fix
- Current setup exposes a randomized path and mishandles `/`. Replace with a fixed HTTP/1.1 WebSocket proxy on **`/`** at the SSH-WS vhost/port, upgrade headers correct (`Upgrade: websocket`, `Connection: Upgrade`, HTTP/1.1 pinned in Nginx `proxy_http_version 1.1`).
- Drop all `/random` path generation from configs and payload generators.

### 3. Python agent API (FastAPI)
Endpoints (all `/api/*`, JWT-protected except `/api/auth/login`):

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET /system/status` — uptime, CPU, RAM, disk, network, service states
- `GET /accounts?protocol=ssh|vmess|vless|trojan` — unified list
- `POST /accounts` — create (protocol, username, expiry, IP limit, **speed limit** kbps, quota GB)
- `PATCH /accounts/:id` — edit expiry / limits / password / uuid
- `DELETE /accounts/:id`
- `POST /accounts/:id/renew`
- `GET /accounts/:id/config` — client config / QR / vmess link
- `GET /usage/online` — currently connected users per protocol
- `GET /usage/traffic?range=…` — per-user bytes in/out, per-user uptime
- `GET /logs?type=audit|service|auth&limit=…` — created/edited/deleted events + service logs
- `POST /system/update` — pull latest from GitHub, run migrations, restart agent
- `GET /system/version` — current commit + latest available

**Speed limit** enforced via `tc` (HTB) per-user classid, keyed to account id; installer adds a helper script the agent calls on create/edit.

### 4. Web UI (TanStack Start in this Lovable project)
Pages:
- `/login` — admin auth
- `/` — Dashboard: uptime, resources, online users, traffic today, service health cards, version + Update button
- `/accounts` — unified table across protocols with filters, bulk actions, create/edit drawer
- `/accounts/:id` — detail: config/QR, live traffic chart, uptime, activity log
- `/logs` — audit + service log viewer with filters
- `/settings` — admin password, DB path (read-only display), cert renewal, danger zone
- `/update` — shows current vs latest commit, changelog, one-click apply

Clean modern shell (sidebar + top bar), no clutter, keyboard-friendly, dark/light.

### 5. Auto-update flow
- Agent stores install root as a git checkout of your GitHub repo.
- `POST /system/update` runs: `git fetch && git reset --hard origin/main`, executes `scripts/migrate.sh` if present, then `systemctl restart autoscript-agent nginx`. Web UI assets rebuilt from a shipped `dist/` in the repo so no Node needed on the VPS.
- Version endpoint compares local HEAD vs `origin/main` via `git ls-remote`.

## Out of scope for Phase 1 (call out explicitly)
- Multi-VPS management from one panel
- Payments / reseller accounts
- Telegram bot rework (kept as-is or disabled)
- Mobile app

## Deliverables in this Lovable project
Because Lovable runs the **web UI** side, this project will contain:
- The TanStack Start web app (all pages above), talking to `/api/*`.
- A `backend/` folder with the Python FastAPI agent source, systemd unit, and the rewritten English bash installer + Nginx templates + SSH-WS config — copied to the VPS by the installer.
- README with install one-liner: `bash <(curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/install.sh)`

## Open items to confirm before I start building
1. **GitHub repo URL** (for installer + self-update source).
2. **acme.sh DNS provider** for wildcard mode (Cloudflare API? something else?) — needed for automated wildcard issuance.
3. Keep the existing **Telegram bot** running untouched, or disable it in Phase 1?
4. Any protocols beyond SSH / VMess / VLESS / Trojan currently in use that must appear in the unified accounts table (Shadowsocks, WireGuard, OpenVPN)?

Once you confirm those four, I'll switch to build mode and start with the web UI scaffold + agent API contracts, then the installer rewrite.