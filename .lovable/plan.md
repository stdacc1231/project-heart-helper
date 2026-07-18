# Plan — Multi-port CDN listener, per-protocol host domains, user sub link, IP limits, remove Nodes

## 1. Installer / Uninstaller rewrite (`backend/install.sh`, new `backend/uninstall.sh`)

**Installer prompts (English, in order):**
1. Panel main domain (e.g. `panel.example.com`) — this is the ONE domain TLS is issued for at install time and is used by every protocol until the user overrides per-protocol hosts in Settings.
2. Panel HTTPS port (default `443`).
3. TLS mode: `1) Single domain` (HTTP-01) or `2) Wildcard *.root` (DNS-01, acme.sh module + creds).
4. Admin user + password.
5. Telegram bot token + admin chat ID (optional).
6. DB path.
7. Repo URL for self-update.

**Ports opened & bound (Cloudflare-supported, multi-port):**
- HTTPS/TLS (CF proxied): `443, 2053, 2083, 2087, 2096, 8443` — all serve the same Nginx vhost (panel + SSH-WS on `/` + xray WS paths).
- HTTP/plain-WS (CF proxied): `80, 8080, 8880, 2052, 2082, 2086, 2095` — same vhost, redirects to HTTPS except keeps `/` SSH-WS reachable in plain WS for injector clients.
- Direct (non-CF) ports for protocols that can't go through CDN: Hysteria2/TUIC UDP, WireGuard UDP, Shadowsocks TCP/UDP — user picks port range, opened in ufw/iptables.

**One TLS cert, shared:** issued for panel main domain (or wildcard). Symlinked into xray so every protocol served through Nginx uses the same fullchain. Additional per-protocol hostnames added later in Settings are automatically added to the cert via `acme.sh --issue -d ... -d newhost` and reloaded.

**Uninstaller (`backend/uninstall.sh`):**
- Stops + disables `autoscript-agent`, `autoscript-ssh-ws`, `autoscript-bot`, `xray`, `nginx` (nginx kept, only our vhost removed).
- Removes `/opt/autoscript`, `/etc/autoscript`, systemd units, nginx vhost, cron jobs, tc rules, iptables rules we added.
- Revokes acme.sh cert for panel domain.
- Purges Cloudflare WARP remnants (already in installer, mirrored here).
- Interactive confirm: `type 'REMOVE' to continue`.

## 2. Nginx template (`backend/nginx/panel.conf.tpl`)

- One `server` block generated per port in the multi-port list; all share the same TLS cert and `server_name` list (panel domain + every per-protocol host from Settings).
- `location = /` handles WebSocket upgrade → SSH-WS bridge on `127.0.0.1:2095`; non-WS falls through to SPA. **Path stays `/`. HTTP/1.1 pinned.**
- `location /vmess|/vless|/trojan` → xray inbounds, HTTP/1.1 pinned, CF real-IP header restored.
- `location /sub/<token>` → agent, returns per-user subscription bundle + HTML detail page.
- Plain-HTTP server blocks on non-TLS CF ports mirror the TLS block minus SSL, so `/` SSH-WS also works over CF plain-WS (used by injector apps on port 80).

Template renders from `panel.domain` + `panel.extraHosts[]` + per-protocol host overrides read from DB by `apply_settings.sh`, so a settings change re-emits the full vhost.

## 3. Per-protocol host domains (Settings page)

Add to `PanelSettings` (both api types and DB `settings` table):
- `hosts.ssh`, `hosts.vmess`, `hosts.vless`, `hosts.trojan`, `hosts.shadowsocks`, `hosts.hysteria2`, `hosts.tuic`, `hosts.wireguard`, `hosts.reality`
- `ports.ssh`, `ports.vmess`, ... (choose from the CF-supported list; validated)

Settings page gets a new "Protocol endpoints" card: one row per protocol with `host` + `port` inputs. Blank = fall back to panel main domain.

Saving triggers `apply_settings.sh`:
1. For each new host not covered by current cert → `acme.sh --issue -d panel -d host1 -d host2 ... --force`.
2. Re-render nginx vhost with combined `server_name`.
3. `nginx -t && systemctl reload nginx && systemctl restart xray`.

Account config export uses each protocol's host+port when building the client link, so users always get the correct endpoint.

## 4. Per-user subscription + live detail link

Agent adds:
- `GET /sub/:token` → returns Base64 subscription bundle (v2rayNG/Clash/sing-box negotiated by `?app=` query).
- `GET /u/:token` → public HTML page (server-rendered by agent, no auth needed, token is unguessable) showing:
  - Account: username, protocol, expiry, quota, plan
  - **Live traffic**: hourly + daily chart of upload/download for the last 30 days (from xray stats API + agent poll every 60s)
  - Data used vs quota, days remaining
  - Current active IPs, device count, last seen
  - Copyable config strings + QR
  - Subscription URL for one-click import

Token stored on the account row, rotatable from the panel.

## 5. IP limit per user (SSH + xray)

- New account field: `ipLimit` (int, 0 = unlimited). Editable in accounts drawer, default from plan.
- **SSH**: enforced by a small watcher in the agent — counts distinct source IPs per SSH user via `ss -tnp | grep sshd`, if over limit → kills the newest sessions and logs. Runs every 15s.
- **xray**: enable stats per user (email tag), agent polls `xray api statsquery`, groups active sessions by client-IP (from access log tail), enforces same way — issues `xray api rm inbound user` for the offending client until under limit, re-adds after cooldown.
- Enforcement events → alerts feed + optional telegram.

## 6. Remove multi-node system

- Delete `src/routes/_authed.nodes.tsx`.
- Remove `Nodes` nav item from `src/components/app-shell.tsx`.
- Remove `nodes` types, mock data, and `api.nodes.*` from `src/lib/api.ts` + `src/lib/mock.ts`.
- No agent-side node code exists yet, so nothing to remove there.

## 7. Files touched

**Backend:**
- `backend/install.sh` — rewrite prompts + multi-port + firewall
- `backend/uninstall.sh` — NEW
- `backend/nginx/panel.conf.tpl` — multi-port + per-proto server_name
- `backend/scripts/apply_settings.sh` — re-render + re-issue cert
- `backend/scripts/ip_limit_watcher.sh` — NEW (systemd timer)
- `backend/systemd/autoscript-ip-limit.{service,timer}` — NEW
- `backend/agent/main.py` — `/sub/:token`, `/u/:token`, per-user traffic endpoint, ipLimit CRUD, settings schema
- `backend/agent/traffic_poller.py` — NEW (xray stats → sqlite hourly buckets)

**Frontend:**
- `src/lib/api.ts` + `src/lib/mock.ts` — extend PanelSettings, add per-user traffic + sub token, remove nodes, add ipLimit
- `src/routes/_authed.settings.tsx` — new "Protocol endpoints" card
- `src/routes/_authed.accounts.tsx` — ipLimit column + editor, "Copy user link" button
- `src/routes/_authed.accounts.$id.tsx` — show sub link + rotate token + IP limit
- `src/components/app-shell.tsx` — remove Nodes nav
- Delete `src/routes/_authed.nodes.tsx`

## 8. Notes

- No 2FA, no xterm terminal, no PWA/push, no audit-diff, no reseller (kept out per earlier decisions).
- Cloudflare Free tier proxies WebSocket only on 80/443/8080/8880/2052/2082/2086/2095 (plain) and 443/2053/2083/2087/2096/8443 (TLS) — the list above matches that exactly.
- Everything remains driven by one panel main domain until the user opts into per-protocol hosts.
