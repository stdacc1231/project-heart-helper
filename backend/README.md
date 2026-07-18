# Autoscript Backend (VPS side)

Everything in this folder is deployed to the VPS by `install.sh`. Lovable
does not run this code — it runs on your server behind Nginx.

## Layout

- `install.sh` — one-shot installer (English). Prompts for domain, TLS mode,
  admin credentials, DB path. Issues certs with acme.sh, installs xray + ssh-ws,
  sets up systemd units, deploys the agent and the web UI bundle.
- `agent/` — FastAPI Python agent (the API the web UI talks to).
- `nginx/` — Nginx templates for the panel vhost + the SSH-WS `/` upgrade.
- `systemd/` — unit files.
- `scripts/` — thin bash wrappers around existing account logic (create user,
  set tc speed limit, revoke, etc). The agent shells out to these.

## Install (on a fresh Ubuntu 22.04+ VPS)

```
bash <(curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/backend/install.sh)
```

You will be asked for:

1. Panel domain (e.g. `panel.example.com`)
2. TLS mode — **1) Single domain** or **2) Wildcard** (DNS-01 via acme.sh)
3. Admin username + password for the web panel
4. DB path (default `/etc/autoscript/db.sqlite`)

The same TLS cert is symlinked into xray so VMess/VLESS/Trojan and the panel
all share one fullchain. Cloudflare WARP / Zero Trust are **not** installed
and are actively purged if found from an older install.

## Self-update

The web UI has an **Update** page. It calls `POST /api/system/update`, which
runs `git fetch && git reset --hard origin/main` inside `/opt/autoscript`,
rebuilds the web panel with Node 22, executes `backend/scripts/migrate.sh` if
present, then restarts `autoscript-agent`, `autoscript-web`, `autoscript-bot`,
`autoscript-ssh-ws` and `nginx`.
