#!/usr/bin/env bash
# Autoscript — complete uninstaller. Ubuntu 22.04/24.04, Debian 12. Run as root.
set -euo pipefail

RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; BLU=$'\e[36m'; RST=$'\e[0m'
say()  { printf '%s\n' "${BLU}==>${RST} $*"; }
ok()   { printf '%s\n' "${GRN}[ok]${RST} $*"; }
warn() { printf '%s\n' "${YLW}[warn]${RST} $*"; }
die()  { printf '%s\n' "${RED}[err]${RST} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Please run as root."

cat <<BANNER
${RED}This will REMOVE:${RST}
  - /opt/autoscript, /etc/autoscript
  - systemd units (agent, ssh-ws, bot, ip-limit)
  - nginx vhost autoscript-panel.conf
  - xray configuration + service (kept only if you re-install)
  - acme.sh cert for the panel domain
  - iptables/tc rules created by this stack
  - cron jobs scheduled by this stack

Databases and cert renewals will be lost. Type ${YLW}REMOVE${RST} to continue:
BANNER
if [[ -r /dev/tty ]]; then IFS= read -r CONFIRM </dev/tty || CONFIRM=""; else IFS= read -r CONFIRM || CONFIRM=""; fi
[[ "$CONFIRM" == "REMOVE" ]] || die "Aborted."

# ---------------------------------------------------------------
say "Stopping services"
for svc in autoscript-agent autoscript-ssh-ws autoscript-bot autoscript-ip-limit.timer autoscript-ip-limit.service xray; do
  systemctl disable --now "$svc" 2>/dev/null || true
done

say "Removing systemd unit files"
rm -f /etc/systemd/system/autoscript-*.service /etc/systemd/system/autoscript-*.timer
systemctl daemon-reload

say "Removing nginx vhost"
rm -f /etc/nginx/sites-enabled/autoscript-panel.conf /etc/nginx/sites-available/autoscript-panel.conf
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true

say "Cleaning firewall rules created by autoscript"
iptables-save 2>/dev/null | grep -v "autoscript" | iptables-restore 2>/dev/null || true
tc qdisc show 2>/dev/null | awk '/htb/ {print $5}' | while read -r dev; do
  tc qdisc del dev "$dev" root 2>/dev/null || true
done

say "Revoking ACME cert"
ACME=~/.acme.sh/acme.sh
if [[ -x "$ACME" && -f /etc/autoscript/agent.env ]]; then
  # shellcheck disable=SC1091
  source /etc/autoscript/agent.env
  "$ACME" --revoke -d "${PANEL_DOMAIN:-}" --ecc 2>/dev/null || true
  "$ACME" --remove -d "${PANEL_DOMAIN:-}" --ecc 2>/dev/null || true
fi

say "Purging Cloudflare WARP / Zero Trust remnants"
systemctl disable --now warp-svc 2>/dev/null || true
systemctl disable --now cloudflared 2>/dev/null || true
apt-get purge -y cloudflare-warp cloudflared 2>/dev/null || true
rm -rf /etc/cloudflared /var/lib/cloudflared /etc/apt/sources.list.d/cloudflare* /usr/local/bin/cloudflared 2>/dev/null || true

say "Removing xray"
systemctl disable --now xray 2>/dev/null || true
rm -rf /usr/local/bin/xray /usr/local/etc/xray /var/log/xray /etc/systemd/system/xray.service

say "Removing directories"
rm -rf /opt/autoscript /etc/autoscript

say "Removing cron entries"
crontab -l 2>/dev/null | grep -v autoscript | crontab - 2>/dev/null || true

ok "Autoscript fully removed."
echo "You can reinstall any time with the one-liner in the README."
