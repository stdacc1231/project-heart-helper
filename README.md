# Autoscript — All-in-One VPN Panel

Modern web panel for managing **SSH-WS, VMess, VLESS and Trojan** on a single VPS.
Built as a TanStack Start web UI on top of a Python (FastAPI) agent that
drives the same battle-tested provisioning scripts the CLI used to run.

- Full menu parity with the old bash CLI, in a clean dark "Aurora Ops" UI.
- SSH-WebSocket fixed on path `/` (HTTP/1.1 compatible, CDN-safe).
- Multi-port listener for every Cloudflare-supported TLS + plain port.
- One panel domain, plus per-protocol host overrides in Settings.
- Per-user speed limit (up/down), quota, IP limit, expiry, QR + sub link.
- Live connections view (kick), hourly traffic graphs, audit log, backups.
- Telegram bot handles **all sales**: payment proof upload → admin approve
  → account auto-created → config + QR delivered in chat.
- Invoices, backups, service controls and GitHub-based panel updates.
- One-click self-update from this GitHub repo.

## Repo layout

```
backend/     # Everything that runs on the VPS (installer, agent, scripts)
src/         # Web UI (TanStack Start, React 19)
```

The `backend/` folder is what the installer deploys to `/opt/autoscript`
on your server. The web UI is built and served by Nginx on the panel domain.

## Install (fresh Ubuntu 22.04+ / Debian 12, as root)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/stdacc1231/project-heart-helper/main/backend/install.sh)
```

The installer will ask for:

1. **Panel domain** (e.g. `panel.example.com`)
2. **Primary HTTPS port** (default `443`)
3. **TLS mode** — `1` single-domain (HTTP-01) or `2` wildcard (DNS-01 via
   acme.sh; you'll be asked for your DNS provider API creds)
4. **Admin username + password** for the panel
5. **DB path** (default `/etc/autoscript/db.sqlite`)
6. **Telegram bot token + admin chat id** (optional — leave blank to skip)

It then:

- Installs xray-core, ssh-ws, nginx, python agent, systemd units.
- Issues TLS certs and symlinks them into xray so the panel and every
  protocol share the same fullchain.
- Opens all Cloudflare-supported ports (TLS: 443,2053,2083,2087,2096,8443
  · plain: 80,8080,8880,2052,2082,2086,2095).
- Purges any pre-existing Cloudflare WARP / Zero Trust install.

## Admin CLI (on the VPS)

After install, an `autoscript` command is available system-wide. Run it as
root for a menu, or use flags for scripting:

```
autoscript              # interactive menu
autoscript status       # panel + service status
autoscript reset-user   # change admin username
autoscript reset-pass   # change admin password
autoscript set-domain   # change panel domain / port / TLS mode (re-issues cert)
autoscript set-repo     # change GitHub repo URL used for updates
autoscript update       # git pull origin main + restart services
autoscript repair       # reinstall/repair Xray, SSH-WS and Nginx
autoscript restart      # restart agent, ssh-ws, bot, nginx
autoscript logs         # tail service logs
autoscript backup       # tar /etc/autoscript + xray config
autoscript set-bot      # set Telegram bot token / admin chat id
autoscript uninstall    # full uninstall
```

If your VPS still shows the old usage text and does not know `repair`, refresh
the CLI once manually:

```bash
install -m 755 /opt/autoscript/backend/cli.sh /usr/local/bin/autoscript
autoscript repair
```

## Uninstall

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/stdacc1231/project-heart-helper/main/backend/uninstall.sh)
```

## Self-update

Push to `main` on this repo, then in the panel open **Update → Pull &
Rebuild**. The agent runs `git fetch && git reset --hard origin/main`
inside `/opt/autoscript`, rebuilds the web panel with Node 22, applies
migrations, and restarts the agent, web server, bot, SSH-WS and Nginx.

## Per-protocol domains

The installer requests **one** panel domain used for TLS. In **Settings →
Protocol endpoints** you can override host/port per protocol (VMess on
`vm.example.com:2083`, Trojan on `tr.example.com:443`, etc). Hit **Apply**
and the agent re-issues certs and reloads nginx + xray.

## Docs

- Backend detail: [`backend/README.md`](backend/README.md)
- Docs site: <https://docs.lovable.dev>

## License

Private / personal use. Do not redistribute without the author's consent.
