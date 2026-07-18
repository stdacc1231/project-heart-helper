# Autoscript All-in-One Panel — Full Plan

## What you asked for (my read-back)

- **Telegram bot stays** and becomes a first-class part of the panel, managed from the UI (not a separate script).
- **DNS / TLS**: wildcard supported via acme.sh DNS-01. Default provider **Cloudflare** (`dns_cf`), other acme.sh modules selectable at install (Gandi, DigitalOcean, etc.). Single-domain (HTTP-01) stays as the easy path.
- **Bot ↔ Panel flow**:
  1. User `/start` → bot shows plans, server info, their existing accounts.
  2. User picks plan → bot sends payment details (QRIS / bank / crypto — configurable in panel).
  3. User uploads payment proof → goes to admin approval queue in the web panel.
  4. Admin approves in panel → account auto-created, config + QR + import links sent back through the bot.
  5. Bot messages auto-delete after **N minutes** (default 10, configurable per message type: config, payment, receipt).
- **Accounts**: link a **Telegram ID** to any account (SSH/VMess/VLESS/Trojan). All CLI options exposed in UI: expiry, IP limit, **speed limit (up/down kbps)**, **quota GB**, password/uuid rotate, renew, lock, delete.
- **Billing**: two modes per plan — **Pay-as-you-go** (per-GB or per-day) and **Prepaid plan** (fixed price / duration / quota). Plans editable in panel.
- **Panel UX**: modern, clean; dashboard with **hourly traffic graphs**, per-service graphs (SSH / Xray inbound), per-user usage sparkline, online users, uptime, live logs. Detailed audit + service logs with filters.
- **SSH-WS path stays `/`** on HTTP/1.1 (already in the template — verified).
- **Installer prompts**: main port (default 443), panel domain, TLS mode (1 single / 2 wildcard + DNS provider), admin username + password, DB path. Same cert reused for Xray. All values changeable later from panel Settings without reinstall.
- **Self-update** from GitHub, one-click from panel.

## Build order

### Phase A — Backend (Python agent + bot)

1. `backend/agent/db.py` — SQLite schema:
   `admins, accounts (with telegram_id, plan_id, speed_up, speed_dn, quota_gb, used_bytes), plans, payments, audit_logs, traffic_samples, settings (kv), bot_users`.
2. `backend/agent/main.py` — expand routes:
   - `/plans` CRUD, `/payments` (list, approve, reject),
   - `/accounts` gains `telegram_id`, `planId`, `speedUp`, `speedDn`, `quotaGb`,
   - `/system/traffic?range=1h|24h|7d` returns hourly buckets (reads `traffic_samples`),
   - `/settings` GET/PATCH (bot token, payment info, domain, port, auto-delete minutes, DNS provider).
3. `backend/agent/traffic_sampler.py` — background task, every minute reads `nft`/`vnstat`/`xray stats` and writes `traffic_samples`.
4. `backend/agent/bot.py` — python-telegram-bot v21 async worker (systemd unit `autoscript-bot.service`).
   - Commands: `/start`, `/me`, `/buy`, `/renew`, `/config`, `/help`.
   - Auto-delete: schedule `deleteMessage` at `settings.auto_delete_minutes`.
   - Uses agent internal HTTP (`127.0.0.1:8088`) with a shared secret so bot ↔ agent stay decoupled.
5. `backend/scripts/*` — already present for provisioning; add `set_quota.sh` and hook `tc_limit.sh` on create/edit.

### Phase B — Installer

Rewrite `backend/install.sh` to prompt in this exact order (all English, defaults in brackets):

```
Panel domain          : panel.example.com
Panel port            : [443]
TLS mode              : 1) single-domain  2) wildcard
  If 2 → root domain, acme.sh DNS module [dns_cf], API credentials
Admin username        : [admin]
Admin password        : ****
Telegram bot token    : (optional; can set later in panel)
Telegram admin chat   : (optional; can set later in panel)
DB path               : [/etc/autoscript/db.sqlite]
GitHub repo (self-update): [<default>]
```

Then: purge Cloudflare WARP/Zero Trust, install nginx+xray+ssh-ws, issue cert, deploy 3 systemd units (`autoscript-agent`, `autoscript-ssh-ws`, `autoscript-bot`), enable timer for `traffic_sampler` and cert renew.

### Phase C — Web UI

New/expanded pages in `src/routes/_authed.*`:

- **Dashboard** (rewrite): hourly RX/TX area chart (recharts), per-protocol online counts, service health, uptime, version + Update button.
- **Accounts** (edit): add `telegramId`, `plan`, `speedUp/Dn`, `quotaGb` in the create/edit drawer; per-row usage bar; QR + config download + import link.
- **Account detail** (edit): 24h traffic sparkline, activity timeline, "send config to Telegram" button.
- **Plans** (new `/plans`): CRUD plans (name, mode: PAYG per-GB / PAYG per-day / prepaid; price; duration; quota; speed caps; ip limit).
- **Payments** (new `/payments`): approval queue — proof screenshot, plan, telegram user; Approve / Reject buttons.
- **Bot** (new `/bot`): token, admin chat id, welcome text, plan-list template, auto-delete minutes, payment instructions (QRIS image upload, bank text, crypto address). "Restart bot" button.
- **Logs** (edit): filters by type, level, actor; live tail toggle.
- **Settings** (edit): panel domain + port change flow (re-runs nginx template + acme.sh switch), DNS provider, admin password, DB path (read-only), danger zone (reinstall xray, purge Cloudflare).
- **Update** (already exists).

### Phase D — API client + mocks

Extend `src/lib/api.ts` and `src/lib/mock.ts` with `plans`, `payments`, `bot`, `settings`, `traffic` endpoints so every new page is clickable in Lovable preview.

## Technical notes

- **Traffic graph source**: `xray stats` API + `iptables -w -nvxL` counters per user (already how the CLI does it). Sampler writes 1-minute rows, dashboard aggregates to hourly.
- **Speed limit**: `tc qdisc` HTB per-user classid, mapped by account id. Wrapper `tc_limit.sh` called on create/edit/delete.
- **Bot ↔ agent auth**: `BOT_INTERNAL_TOKEN` shared secret in `/etc/autoscript/agent.env`, sent as `X-Internal-Token` header. Bot never talks to the DB directly — only through the agent, so all business rules (quota checks, expiry, audit logs) stay in one place.
- **Auto-delete**: scheduled with `asyncio.create_task(sleep + delete)` inside the bot; also persisted so a bot restart re-schedules pending deletions.
- **Payment approval**: bot uploads the proof file to `/etc/autoscript/uploads/`; the panel serves it via signed URL from the agent.
- **Domain/port change**: `/settings/apply` rewrites nginx template, reissues cert if domain changed, restarts nginx + xray + agent — all from the panel, no SSH needed.

## Out of scope (still)

- Multi-VPS orchestration.
- Reseller sub-accounts.
- Mobile app.

## One thing I still need from you

**GitHub repo URL** for the installer's `curl | bash` one-liner and the self-update source. Say the word and I start Phase A.
