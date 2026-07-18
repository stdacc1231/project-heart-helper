#!/usr/bin/env bash
# Autoscript Web Panel — installer (English).
# Ubuntu 22.04 / 24.04 / Debian 12. Run as root.
set -euo pipefail

RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; BLU=$'\e[36m'; RST=$'\e[0m'
say()  { printf '%s\n' "${BLU}==>${RST} $*"; }
ok()   { printf '%s\n' "${GRN}[ok]${RST} $*"; }
warn() { printf '%s\n' "${YLW}[warn]${RST} $*"; }
die()  { printf '%s\n' "${RED}[err]${RST} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Please run as root."

REPO_DEFAULT="https://github.com/your-user/autoscript.git"
INSTALL_ROOT="/opt/autoscript"
CONF_DIR="/etc/autoscript"
DB_DEFAULT="${CONF_DIR}/db.sqlite"

# --------------------------------------------------------------------------
# Prompts (all English)
# --------------------------------------------------------------------------
say "Autoscript Web Panel installer"
read -rp "Panel domain (e.g. panel.example.com): " PANEL_DOMAIN
[[ -n "$PANEL_DOMAIN" ]] || die "Domain is required."

echo "Certificate mode:"
echo "  1) Single domain   (HTTP-01, easiest, uses only ${PANEL_DOMAIN})"
echo "  2) Wildcard        (DNS-01, one cert for *.<root>, needs DNS API creds)"
read -rp "Choose [1-2]: " TLS_MODE
TLS_MODE=${TLS_MODE:-1}

if [[ "$TLS_MODE" == "2" ]]; then
  read -rp "Root domain for wildcard (e.g. example.com): " ROOT_DOMAIN
  echo "DNS API provider (e.g. dns_cf for Cloudflare, dns_gandi_livedns, dns_do)"
  read -rp "acme.sh DNS module [dns_cf]: " DNS_API
  DNS_API=${DNS_API:-dns_cf}
  echo "Export the API credentials for acme.sh before re-running, or paste them now."
fi

read -rp "Admin username [admin]: " ADMIN_USER
ADMIN_USER=${ADMIN_USER:-admin}
read -rsp "Admin password: " ADMIN_PASS; echo
[[ -n "$ADMIN_PASS" ]] || die "Password is required."

read -rp "Database path [${DB_DEFAULT}]: " DB_PATH
DB_PATH=${DB_PATH:-$DB_DEFAULT}

read -rp "Repo URL for self-update [${REPO_DEFAULT}]: " REPO
REPO=${REPO:-$REPO_DEFAULT}

# --------------------------------------------------------------------------
# System packages
# --------------------------------------------------------------------------
say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  git curl wget ca-certificates jq socat cron \
  python3 python3-venv python3-pip \
  nginx iproute2 iptables uuid-runtime openssl

# --------------------------------------------------------------------------
# Purge Cloudflare WARP / Zero Trust if a previous install left them
# --------------------------------------------------------------------------
say "Removing any Cloudflare WARP / Zero Trust remnants"
systemctl disable --now warp-svc 2>/dev/null || true
systemctl disable --now cloudflared 2>/dev/null || true
apt-get purge -y cloudflare-warp cloudflared 2>/dev/null || true
rm -rf /etc/cloudflared /var/lib/cloudflared /etc/apt/sources.list.d/cloudflare* \
       /usr/local/bin/cloudflared 2>/dev/null || true
ok "Cloudflare components removed."

# --------------------------------------------------------------------------
# Clone repo
# --------------------------------------------------------------------------
say "Fetching Autoscript repo"
if [[ -d "$INSTALL_ROOT/.git" ]]; then
  git -C "$INSTALL_ROOT" fetch --all
  git -C "$INSTALL_ROOT" reset --hard origin/main
else
  git clone "$REPO" "$INSTALL_ROOT"
fi

# --------------------------------------------------------------------------
# TLS via acme.sh — one cert shared by nginx + xray
# --------------------------------------------------------------------------
say "Installing acme.sh"
if ! command -v acme.sh >/dev/null; then
  curl -fsSL https://get.acme.sh | sh -s email=admin@"${PANEL_DOMAIN#*.}"
fi
ACME=~/.acme.sh/acme.sh
"$ACME" --set-default-ca --server letsencrypt

mkdir -p "$CONF_DIR/certs"
CERT_DIR="$CONF_DIR/certs"

if [[ "$TLS_MODE" == "2" ]]; then
  say "Issuing wildcard certificate for *.${ROOT_DOMAIN} via ${DNS_API}"
  "$ACME" --issue --dns "$DNS_API" -d "$ROOT_DOMAIN" -d "*.$ROOT_DOMAIN" --keylength ec-256
  "$ACME" --install-cert -d "$ROOT_DOMAIN" --ecc \
     --fullchain-file "$CERT_DIR/fullchain.pem" \
     --key-file       "$CERT_DIR/privkey.pem"  \
     --reloadcmd     "systemctl reload nginx && systemctl restart xray"
else
  say "Issuing single-domain certificate for ${PANEL_DOMAIN} via HTTP-01"
  # Temporary standalone port 80
  systemctl stop nginx 2>/dev/null || true
  "$ACME" --issue --standalone -d "$PANEL_DOMAIN" --keylength ec-256
  "$ACME" --install-cert -d "$PANEL_DOMAIN" --ecc \
     --fullchain-file "$CERT_DIR/fullchain.pem" \
     --key-file       "$CERT_DIR/privkey.pem"  \
     --reloadcmd     "systemctl reload nginx && systemctl restart xray"
fi
ok "TLS certificate installed at $CERT_DIR"

# --------------------------------------------------------------------------
# Config file (agent reads this)
# --------------------------------------------------------------------------
say "Writing agent config"
mkdir -p "$CONF_DIR"
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_HASH=$(python3 -c "import crypt,secrets; print(crypt.crypt('$ADMIN_PASS', crypt.mksalt(crypt.METHOD_SHA512)))")
cat >"$CONF_DIR/agent.env" <<EOF
PANEL_DOMAIN=${PANEL_DOMAIN}
DB_PATH=${DB_PATH}
JWT_SECRET=${JWT_SECRET}
ADMIN_USER=${ADMIN_USER}
ADMIN_HASH='${ADMIN_HASH}'
REPO_URL=${REPO}
INSTALL_ROOT=${INSTALL_ROOT}
CERT_FULLCHAIN=${CERT_DIR}/fullchain.pem
CERT_KEY=${CERT_DIR}/privkey.pem
EOF
chmod 600 "$CONF_DIR/agent.env"

# --------------------------------------------------------------------------
# Python venv + agent
# --------------------------------------------------------------------------
say "Setting up Python agent"
python3 -m venv "$INSTALL_ROOT/backend/.venv"
"$INSTALL_ROOT/backend/.venv/bin/pip" install --upgrade pip
"$INSTALL_ROOT/backend/.venv/bin/pip" install -r "$INSTALL_ROOT/backend/agent/requirements.txt"

# --------------------------------------------------------------------------
# Nginx vhost — panel + SSH-WS on /
# --------------------------------------------------------------------------
say "Configuring Nginx"
install -m 644 "$INSTALL_ROOT/backend/nginx/panel.conf.tpl" /etc/nginx/sites-available/autoscript-panel.conf
sed -i "s|__DOMAIN__|${PANEL_DOMAIN}|g; s|__ROOT__|${INSTALL_ROOT}|g; s|__CERT__|${CERT_DIR}|g" \
    /etc/nginx/sites-available/autoscript-panel.conf
ln -sf /etc/nginx/sites-available/autoscript-panel.conf /etc/nginx/sites-enabled/autoscript-panel.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# --------------------------------------------------------------------------
# Systemd units
# --------------------------------------------------------------------------
say "Installing systemd units"
install -m 644 "$INSTALL_ROOT/backend/systemd/autoscript-agent.service" /etc/systemd/system/
install -m 644 "$INSTALL_ROOT/backend/systemd/autoscript-ssh-ws.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now autoscript-agent
systemctl enable --now autoscript-ssh-ws

# --------------------------------------------------------------------------
# Xray (if installer script bundled)
# --------------------------------------------------------------------------
if [[ -x "$INSTALL_ROOT/backend/scripts/setup_xray.sh" ]]; then
  say "Configuring xray"
  PANEL_DOMAIN="$PANEL_DOMAIN" CERT_DIR="$CERT_DIR" bash "$INSTALL_ROOT/backend/scripts/setup_xray.sh"
fi

ok "Installation complete."
echo
echo "  Panel URL : https://${PANEL_DOMAIN}"
echo "  Username  : ${ADMIN_USER}"
echo "  DB path   : ${DB_PATH}"
echo "  Repo      : ${REPO}"
echo
echo "Sign in and use the Update page to pull future changes."
