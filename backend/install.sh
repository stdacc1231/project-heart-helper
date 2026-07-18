#!/usr/bin/env bash
# Autoscript Web Panel — installer (English, all-in-one, hardened).
# Ubuntu 22.04/24.04, Debian 12. Run as root.
set -euo pipefail

RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; BLU=$'\e[36m'; BLD=$'\e[1m'; RST=$'\e[0m'
say()  { printf '%s\n' "${BLU}==>${RST} $*"; }
ok()   { printf '%s\n' "${GRN}[ok]${RST} $*"; }
warn() { printf '%s\n' "${YLW}[warn]${RST} $*"; }
die()  { printf '%s\n' "${RED}[err]${RST} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Please run as root."

REPO_DEFAULT="https://github.com/stdacc1231/project-heart-helper.git"
INSTALL_ROOT="/opt/autoscript"
CONF_DIR="/etc/autoscript"
DB_DEFAULT="${CONF_DIR}/db.sqlite"

# Cloudflare-supported ports (used by Nginx for the VPN protocols only).
TLS_PORTS_DEFAULT="443,2053,2083,2087,2096,8443"
PLAIN_PORTS_DEFAULT="80,8080,8880,2052,2082,2086,2095"
CF_PORTS_ALL="443 2053 2083 2087 2096 8443 80 8080 8880 2052 2082 2086 2095"

# ---------- helpers ----------
rand_chars() { local chars=$1 n=$2 out=""; while [[ ${#out} -lt $n ]]; do out+=$(LC_ALL=C tr -dc "$chars" </dev/urandom | head -c "$((n-${#out}))" || true); done; printf '%s' "$out"; }
rand_slug() { rand_chars 'a-z0-9' "${1:-14}"; }
rand_pass() { rand_chars 'A-Za-z0-9' 18; }
pick_port() {
  # Random high port not in CF list and not currently listening.
  local p
  while :; do
    p=$(( (RANDOM % 40000) + 20000 ))
    for cf in $CF_PORTS_ALL; do [[ $p -eq $cf ]] && continue 2; done
    ss -H -tln 2>/dev/null | awk '{print $4}' | grep -q ":${p}$" && continue
    echo "$p"; return
  done
}
node_major() { node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0; }
ensure_node22() {
  local major
  major="$(node_major)"
  if ! command -v node >/dev/null 2>&1 || [[ "$major" -lt 22 ]]; then
    say "Installing Node.js 22 LTS for web UI build"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  major="$(node_major)"
  [[ "$major" -ge 22 ]] || die "Node.js 22+ is required; current node is $(node -v 2>/dev/null || echo missing)."
}
build_web_ui() {
  cd "$INSTALL_ROOT"
  if command -v bun >/dev/null 2>&1 && [[ -f bun.lock || -f bun.lockb ]]; then
    bun install --production=false
    bun run build
  else
    if [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then
      npm ci --no-audit --no-fund
    else
      npm install --no-audit --no-fund
    fi
    npm run build
  fi
  # Normalise the SPA output into "$INSTALL_ROOT/dist" so the FastAPI agent
  # can serve it regardless of which framework/build tool produced it.
  local src=""
  for cand in dist .output/public build out; do
    if [[ -f "$INSTALL_ROOT/$cand/index.html" ]]; then src="$INSTALL_ROOT/$cand"; break; fi
  done
  if [[ -z "$src" ]]; then
    warn "No index.html found in dist/.output/public/build/out — SPA will not load."
    return 1
  fi
  if [[ "$src" != "$INSTALL_ROOT/dist" ]]; then
    rm -rf "$INSTALL_ROOT/dist"
    cp -a "$src" "$INSTALL_ROOT/dist"
  fi
  ok "SPA staged at $INSTALL_ROOT/dist (from ${src#$INSTALL_ROOT/})"
}
# Read from the controlling terminal so `bash <(curl ...)` still works
# (otherwise stdin is the piped script and every `read` hits EOF).
if { exec 3</dev/tty; } 2>/dev/null; then :; else exec 3<&0; fi
ask()    { local __v; IFS= read -r -u 3 -p "$1" __v || __v=""; printf -v "$2" '%s' "$__v"; }
ask_pw() { local __v; IFS= read -r -s -u 3 -p "$1" __v || __v=""; echo; printf -v "$2" '%s' "$__v"; }

# --------------------------------------------------------------------------
say "Autoscript Web Panel installer"
ask "Panel MAIN domain (e.g. panel.example.com): " PANEL_DOMAIN
[[ -n "$PANEL_DOMAIN" ]] || die "Domain is required."

echo "Certificate mode:"
echo "  1) Single domain  (HTTP-01)"
echo "  2) Wildcard       (DNS-01 — needs DNS API creds exported in env)"
ask "Choose [1-2]: " TLS_MODE
TLS_MODE=${TLS_MODE:-1}

DNS_API=""; ROOT_DOMAIN=""
if [[ "$TLS_MODE" == "2" ]]; then
  ask "Root domain for wildcard (e.g. example.com): " ROOT_DOMAIN
  ask "acme.sh DNS module [dns_cf]: " DNS_API
  DNS_API=${DNS_API:-dns_cf}
  warn "Export the ${DNS_API} API credentials in this shell before continuing."
fi

ask "Admin username [admin]: " ADMIN_USER
ADMIN_USER=${ADMIN_USER:-admin}
ask_pw "Admin password (leave blank to auto-generate): " ADMIN_PASS
if [[ -z "$ADMIN_PASS" ]]; then
  ADMIN_PASS=$(rand_pass)
  AUTO_PASS=1
fi

ask "Telegram bot token (optional, Enter to skip): " BOT_TOKEN
ask "Telegram admin chat ID (optional, Enter to skip): " BOT_ADMIN_CHAT


DB_PATH="$DB_DEFAULT"
REPO="$REPO_DEFAULT"

# Auto-picked, not asked
PANEL_PORT=$(pick_port)
PANEL_PATH=$(rand_slug 14)

# --------------------------------------------------------------------------
say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  git curl wget ca-certificates jq socat cron sqlite3 \
  python3 python3-venv python3-pip \
  nginx iproute2 iptables uuid-runtime openssl \
  fail2ban ufw unzip build-essential

# Node 22+ is required by the current web UI toolchain.
ensure_node22

# --------------------------------------------------------------------------
say "Removing any Cloudflare WARP / Zero Trust remnants"
systemctl disable --now warp-svc 2>/dev/null || true
systemctl disable --now cloudflared 2>/dev/null || true
apt-get purge -y cloudflare-warp cloudflared 2>/dev/null || true
rm -rf /etc/cloudflared /var/lib/cloudflared /etc/apt/sources.list.d/cloudflare* \
       /usr/local/bin/cloudflared 2>/dev/null || true
ok "Cloudflare components removed."

# --------------------------------------------------------------------------
say "Fetching Autoscript repo"
if [[ -d "$INSTALL_ROOT/.git" ]]; then
  git -C "$INSTALL_ROOT" fetch --all
  git -C "$INSTALL_ROOT" reset --hard origin/main
else
  git clone "$REPO" "$INSTALL_ROOT"
fi

# --------------------------------------------------------------------------
say "Building the web UI (npm build → dist/)"
build_web_ui || warn "SPA build failed — panel will not load until you run 'autoscript update'."

# --------------------------------------------------------------------------
say "Installing acme.sh"
if [[ ! -x "$HOME/.acme.sh/acme.sh" ]]; then
  curl -fsSL https://get.acme.sh | sh -s email=admin@"${PANEL_DOMAIN#*.}"
fi
ACME=~/.acme.sh/acme.sh
"$ACME" --set-default-ca --server letsencrypt

mkdir -p "$CONF_DIR/certs" "$CONF_DIR/uploads"
CERT_DIR="$CONF_DIR/certs"

if [[ "$TLS_MODE" == "2" ]]; then
  say "Issuing wildcard cert for *.${ROOT_DOMAIN} via ${DNS_API}"
  "$ACME" --issue --dns "$DNS_API" -d "$ROOT_DOMAIN" -d "*.$ROOT_DOMAIN" --keylength ec-256
  "$ACME" --install-cert -d "$ROOT_DOMAIN" --ecc \
     --fullchain-file "$CERT_DIR/fullchain.pem" \
     --key-file       "$CERT_DIR/privkey.pem"  \
     --reloadcmd     "systemctl reload-or-restart nginx; systemctl restart autoscript-agent xray 2>/dev/null || true"
else
  say "Issuing single-domain cert for ${PANEL_DOMAIN} via HTTP-01"
  systemctl stop nginx 2>/dev/null || true
  "$ACME" --issue --standalone -d "$PANEL_DOMAIN" --keylength ec-256
  "$ACME" --install-cert -d "$PANEL_DOMAIN" --ecc \
     --fullchain-file "$CERT_DIR/fullchain.pem" \
     --key-file       "$CERT_DIR/privkey.pem"  \
     --reloadcmd     "systemctl reload-or-restart nginx; systemctl restart autoscript-agent xray 2>/dev/null || true"
fi
ok "TLS installed at $CERT_DIR"

# --------------------------------------------------------------------------
say "Writing agent config"
JWT_SECRET=$(openssl rand -hex 32)
BOT_INTERNAL_TOKEN=$(openssl rand -hex 32)
GATE_SECRET=$(openssl rand -hex 32)

# passlib bcrypt (matches the agent's verifier)
python3 -m venv "$INSTALL_ROOT/backend/.venv"
"$INSTALL_ROOT/backend/.venv/bin/pip" install --upgrade pip >/dev/null
"$INSTALL_ROOT/backend/.venv/bin/pip" install -r "$INSTALL_ROOT/backend/agent/requirements.txt"
ADMIN_HASH=$("$INSTALL_ROOT/backend/.venv/bin/python" -c \
  "from passlib.hash import bcrypt,argon2; import sys; print(argon2.hash(sys.argv[1]))" "$ADMIN_PASS")

umask 077
cat >"$CONF_DIR/agent.env" <<EOF
PANEL_DOMAIN=${PANEL_DOMAIN}
PANEL_PORT=${PANEL_PORT}
PANEL_PATH=${PANEL_PATH}
GATE_SECRET=${GATE_SECRET}
DB_PATH=${DB_PATH}
JWT_SECRET=${JWT_SECRET}
BOT_INTERNAL_TOKEN=${BOT_INTERNAL_TOKEN}
ADMIN_USER=${ADMIN_USER}
ADMIN_HASH='${ADMIN_HASH}'
REPO_URL=${REPO}
INSTALL_ROOT=${INSTALL_ROOT}
UPLOAD_DIR=${CONF_DIR}/uploads
AGENT_URL=https://127.0.0.1:${PANEL_PORT}
CERT_FULLCHAIN=${CERT_DIR}/fullchain.pem
CERT_KEY=${CERT_DIR}/privkey.pem
EOF
chmod 600 "$CONF_DIR/agent.env"

# --------------------------------------------------------------------------
say "Seeding DB defaults"
"$INSTALL_ROOT/backend/.venv/bin/python" - <<PY
import sqlite3, pathlib
db_path = "${DB_PATH}"
pathlib.Path(db_path).parent.mkdir(parents=True, exist_ok=True)
con = sqlite3.connect(db_path)
con.executescript("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);")
def kv(k,v):
    con.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(k,v))
kv("panel.domain",       "${PANEL_DOMAIN}")
kv("panel.port",         "${PANEL_PORT}")
kv("panel.path",         "${PANEL_PATH}")
kv("panel.tlsMode",      "wildcard" if "${TLS_MODE}"=="2" else "single")
kv("panel.dnsProvider",  "${DNS_API}")
kv("panel.rootDomain",   "${ROOT_DOMAIN}")
kv("panel.tlsPorts",     "${TLS_PORTS_DEFAULT}")
kv("panel.plainPorts",   "${PLAIN_PORTS_DEFAULT}")
kv("bot.token",          "${BOT_TOKEN}")
kv("bot.adminChatId",    "${BOT_ADMIN_CHAT}")
kv("bot.enabled",        "1" if "${BOT_TOKEN}" else "0")
kv("bot.welcomeText",    "Welcome! Tap a plan to purchase.")
kv("bot.paymentInstructions","Send payment and reply here with a receipt screenshot.")
kv("bot.autoDeleteMinutes","10")
con.commit(); con.close()
PY

# --------------------------------------------------------------------------
say "Rendering Nginx vhost (VPN protocols on Cloudflare ports)"
chmod +x "$INSTALL_ROOT/backend/scripts/"*.sh
bash "$INSTALL_ROOT/backend/scripts/apply_settings.sh"
rm -f /etc/nginx/sites-enabled/default
systemctl enable --now nginx
systemctl reload-or-restart nginx

# --------------------------------------------------------------------------
say "Installing systemd units"
install -m 644 "$INSTALL_ROOT/backend/systemd/autoscript-agent.service"    /etc/systemd/system/
install -m 644 "$INSTALL_ROOT/backend/systemd/autoscript-ssh-ws.service"   /etc/systemd/system/
install -m 644 "$INSTALL_ROOT/backend/systemd/autoscript-bot.service"      /etc/systemd/system/
install -m 644 "$INSTALL_ROOT/backend/systemd/autoscript-ip-limit.service" /etc/systemd/system/
install -m 644 "$INSTALL_ROOT/backend/systemd/autoscript-ip-limit.timer"   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now autoscript-agent autoscript-ssh-ws autoscript-bot autoscript-ip-limit.timer

# --------------------------------------------------------------------------
if [[ -x "$INSTALL_ROOT/backend/scripts/setup_xray.sh" ]]; then
  say "Configuring xray"
  PANEL_DOMAIN="$PANEL_DOMAIN" CERT_DIR="$CERT_DIR" \
    bash "$INSTALL_ROOT/backend/scripts/setup_xray.sh" || true
fi

# --------------------------------------------------------------------------
say "Configuring fail2ban"
mkdir -p /etc/fail2ban/filter.d
cat >/etc/fail2ban/filter.d/autoscript-panel.conf <<'EOF'
[Definition]
failregex = ^.*Failed login for .* from <HOST>.*$
            ^.*panel-gate-reject <HOST>.*$
ignoreregex =
EOF
cat >/etc/fail2ban/jail.d/autoscript.conf <<EOF
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
banaction = iptables-multiport

[sshd]
enabled = true

[autoscript-panel]
enabled  = true
filter   = autoscript-panel
backend  = systemd
journalmatch = _SYSTEMD_UNIT=autoscript-agent.service
maxretry = 5
findtime = 10m
bantime  = 2h

[nginx-limit-req]
enabled = true
port    = http,https,${TLS_PORTS_DEFAULT//,/ },${PLAIN_PORTS_DEFAULT//,/ }
logpath = /var/log/nginx/autoscript-error.log
maxretry = 10
findtime = 5m
bantime  = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban || true

# --------------------------------------------------------------------------
say "Configuring UFW firewall"
ufw --force reset >/dev/null 2>&1 || true
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'ssh'
for p in $TLS_PORTS_DEFAULT $PLAIN_PORTS_DEFAULT; do
  for pp in ${p//,/ }; do ufw allow ${pp}/tcp comment 'autoscript-vpn'; done
done
ufw allow ${PANEL_PORT}/tcp comment 'autoscript-panel'
ufw --force enable

# --------------------------------------------------------------------------
say "Installing admin CLI  ->  /usr/local/bin/autoscript"
install -m 755 "$INSTALL_ROOT/backend/cli.sh" /usr/local/bin/autoscript

# --------------------------------------------------------------------------
PANEL_URL="https://${PANEL_DOMAIN}:${PANEL_PORT}/${PANEL_PATH}/"
CREDS_FILE="${CONF_DIR}/panel-credentials.txt"
cat >"$CREDS_FILE" <<EOF
Autoscript Panel credentials (keep this file secret)
====================================================
URL       : ${PANEL_URL}
Username  : ${ADMIN_USER}
Password  : ${ADMIN_PASS}
Port      : ${PANEL_PORT}    (change: autoscript set-port)
Path slug : ${PANEL_PATH}    (change: autoscript set-path)
EOF
chmod 600 "$CREDS_FILE"

ok "Installation complete."
echo
echo "  ${BLD}Panel URL${RST}      : ${PANEL_URL}"
echo "  ${BLD}Admin user${RST}     : ${ADMIN_USER}"
[[ "${AUTO_PASS:-0}" == "1" ]] && echo "  ${BLD}Admin pass${RST}     : ${ADMIN_PASS}   ${YLW}(auto-generated — change with 'autoscript reset-pass')${RST}"
echo "  ${BLD}Random port${RST}    : ${PANEL_PORT}   (not on Cloudflare list; Nginx is VPN-only)"
echo "  ${BLD}Secret path${RST}    : /${PANEL_PATH}/  (obscures the panel from probes)"
echo "  ${BLD}TLS ports (VPN)${RST}: ${TLS_PORTS_DEFAULT}"
echo "  ${BLD}Plain ports (VPN)${RST}: ${PLAIN_PORTS_DEFAULT}   (SSH-WS on '/')"
echo "  ${BLD}Firewall${RST}       : ufw enabled — SSH + CF VPN ports + panel port only"
echo "  ${BLD}Fail2ban${RST}       : sshd + autoscript-panel + nginx jails active"
echo "  ${BLD}Credentials${RST}    : ${CREDS_FILE}"
echo
echo "  ${BLD}Admin CLI${RST}      : run  autoscript   (menu with reset/port/path/domain/update/uninstall)"
echo "  ${BLD}Uninstall${RST}      : autoscript uninstall"
echo
echo "Set per-protocol hosts in Panel → Settings → Protocol endpoints."
