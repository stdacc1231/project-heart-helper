#!/usr/bin/env bash
# Autoscript admin CLI — small on-VPS menu.
# Installed as /usr/local/bin/autoscript.
set -euo pipefail

RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; BLU=$'\e[36m'; BLD=$'\e[1m'; RST=$'\e[0m'
say()  { printf '%s\n' "${BLU}==>${RST} $*"; }
ok()   { printf '%s\n' "${GRN}[ok]${RST} $*"; }
warn() { printf '%s\n' "${YLW}[warn]${RST} $*"; }
die()  { printf '%s\n' "${RED}[err]${RST} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Please run as root (sudo autoscript)."

INSTALL_ROOT=/opt/autoscript
CONF_DIR=/etc/autoscript
ENV_FILE="$CONF_DIR/agent.env"
[[ -f "$ENV_FILE" ]] || die "Panel not installed. Run install.sh first."
# shellcheck disable=SC1090
source "$ENV_FILE"

VENV_PY="$INSTALL_ROOT/backend/.venv/bin/python"

# ---------- helpers ----------
set_env() {  # set_env KEY value
  local key=$1 val=$2
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val//|/\\|}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}
set_setting() {  # set_setting key value
  "$VENV_PY" - "$DB_PATH" "$1" "$2" <<'PY'
import sqlite3, sys
db, k, v = sys.argv[1:4]
con = sqlite3.connect(db)
con.execute("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)")
con.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(k,v))
con.commit(); con.close()
PY
}
restart_stack() {
  systemctl restart autoscript-agent autoscript-ssh-ws autoscript-bot autoscript-web 2>/dev/null || true
  systemctl reload-or-restart nginx 2>/dev/null || true
}
# Read from the controlling terminal so commands still work with piped/stdin use.
if { exec 3</dev/tty; } 2>/dev/null; then :; else exec 3<&0; fi
ask()    { local __v; IFS= read -r -u 3 -p "$1" __v || __v=""; printf -v "$2" '%s' "$__v"; }
ask_pw() { local __v; IFS= read -r -s -u 3 -p "$1" __v || __v=""; echo; printf -v "$2" '%s' "$__v"; }
rand_chars() { local chars=$1 n=$2 out=""; while [[ ${#out} -lt $n ]]; do out+=$(LC_ALL=C tr -dc "$chars" </dev/urandom | head -c "$((n-${#out}))" || true); done; printf '%s' "$out"; }
rand_slug() { rand_chars 'a-z0-9' "${1:-14}"; }
rand_pass() { rand_chars 'A-Za-z0-9' 18; }
CF_PORTS_ALL="443 2053 2083 2087 2096 8443 80 8080 8880 2052 2082 2086 2095"
pick_port() {
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
  cd "$INSTALL_ROOT" || die "Install dir missing."
  export NITRO_PRESET=node-server
  if command -v bun >/dev/null 2>&1 && [[ -f bun.lock || -f bun.lockb ]]; then
    bun install --production=false && bun run build
  else
    if [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then
      npm ci --no-audit --no-fund
    else
      npm install --no-audit --no-fund
    fi
    npm run build
  fi
  if [[ -f "$INSTALL_ROOT/dist/server/index.mjs" || -f "$INSTALL_ROOT/.output/server/index.mjs" ]]; then
    ok "Web server bundle ready"
    return 0
  fi
  warn "Web server bundle not found (expected dist/server/index.mjs or .output/server/index.mjs)"
  return 1
}


# ---------- actions ----------
show_status() {
  echo
  echo "${BLD}Panel${RST}       : https://${PANEL_DOMAIN}:${PANEL_PORT}/${PANEL_PATH:-}/"
  echo "${BLD}Admin user${RST}  : ${ADMIN_USER}"
  echo "${BLD}DB${RST}          : ${DB_PATH}"
  echo "${BLD}Repo${RST}        : ${REPO_URL:-<none>}"
  echo "${BLD}Install dir${RST} : ${INSTALL_ROOT}"
  echo
  for u in autoscript-agent autoscript-web autoscript-ssh-ws autoscript-bot nginx fail2ban; do
    printf "  %-22s %s\n" "$u" "$(systemctl is-active "$u" 2>/dev/null || echo inactive)"
  done
  echo
}

reset_admin_user() {
  ask "New admin username [$ADMIN_USER]: " u
  u=${u:-$ADMIN_USER}
  [[ "$u" =~ ^[a-zA-Z0-9_.-]{2,32}$ ]] || die "Invalid username."
  set_env ADMIN_USER "$u"
  set_setting "admin.username" "$u"
  restart_stack
  ok "Admin username set to '$u'."
}

reset_admin_password() {
  ask_pw "New admin password (blank to auto-generate): " p1
  local auto=0
  if [[ -z "$p1" ]]; then
    p1=$(rand_pass); auto=1
  else
    ask_pw "Repeat password : " p2
    [[ "$p1" == "$p2" && ${#p1} -ge 6 ]] || die "Passwords do not match or too short (min 6)."
  fi
  local hash
  hash=$("$VENV_PY" -c "from passlib.hash import argon2; import sys; print(argon2.hash(sys.argv[1]))" "$p1")
  set_env ADMIN_HASH "'$hash'"
  set_setting "admin.hash" "$hash"
  restart_stack
  ok "Admin password updated."
  [[ $auto -eq 1 ]] && echo "  New password: ${BLD}${p1}${RST}"
}

change_panel_port() {
  local old="$PANEL_PORT" new
  echo "Current panel port: ${old}"
  ask "New port (blank = auto-random, must avoid CF ports): " new
  if [[ -z "$new" ]]; then
    new=$(pick_port)
  else
    [[ "$new" =~ ^[0-9]+$ ]] || die "Port must be numeric."
    for cf in $CF_PORTS_ALL; do [[ "$new" -eq "$cf" ]] && die "Port $new is a Cloudflare/Nginx VPN port."; done
  fi
  set_env PANEL_PORT "$new"
  set_setting "panel.port" "$new"
  ufw allow "${new}/tcp" comment 'autoscript-panel' >/dev/null 2>&1 || true
  ufw delete allow "${old}/tcp" >/dev/null 2>&1 || true
  systemctl restart autoscript-agent
  ok "Panel now listens on port ${new}. URL: https://${PANEL_DOMAIN}:${new}/${PANEL_PATH:-}/"
}

change_panel_path() {
  echo "Current secret path: /${PANEL_PATH:-<none>}/"
  ask "New path slug (blank = regenerate random, '-' to disable): " p
  if [[ -z "$p" ]]; then p=$(rand_slug 14)
  elif [[ "$p" == "-" ]]; then p=""
  else
    [[ "$p" =~ ^[a-zA-Z0-9_-]{4,40}$ ]] || die "Path must be 4-40 chars: letters, digits, _ or -"
  fi
  set_env PANEL_PATH "$p"
  set_setting "panel.path" "$p"
  systemctl restart autoscript-agent
  if [[ -n "$p" ]]; then
    ok "Panel URL: https://${PANEL_DOMAIN}:${PANEL_PORT}/${p}/"
  else
    ok "Secret path disabled. Panel URL: https://${PANEL_DOMAIN}:${PANEL_PORT}/"
  fi
}

change_panel_domain() {
  ask "New panel domain (current: $PANEL_DOMAIN): " d
  [[ -n "$d" ]] || die "Domain required."
  echo "TLS mode:  1) single-domain  2) wildcard"
  ask "Choose [1-2, current mode kept if blank]: " mode
  set_env PANEL_DOMAIN "$d"
  set_setting "panel.domain" "$d"
  [[ "$mode" == "1" ]] && set_setting "panel.tlsMode" "single"
  [[ "$mode" == "2" ]] && set_setting "panel.tlsMode" "wildcard"
  say "Re-issuing TLS + reloading nginx…"
  bash "$INSTALL_ROOT/backend/scripts/apply_settings.sh"
  restart_stack
  ok "Panel domain is now https://${d}:${PANEL_PORT}/${PANEL_PATH:-}/"
}

change_repo_url() {
  ask "New GitHub repo URL [${REPO_URL:-none}]: " r
  [[ -n "$r" ]] || die "Repo URL required."
  set_env REPO_URL "$r"
  ( cd "$INSTALL_ROOT" && git remote set-url origin "$r" 2>/dev/null || git init -q && git remote add origin "$r" )
  ok "Repo set to $r"
}

update_now() {
  cd "$INSTALL_ROOT" || die "Install dir missing."
  say "git fetch && reset --hard origin/main"
  git fetch --all --prune
  git reset --hard origin/main
  if [[ -f backend/scripts/migrate.sh ]]; then bash backend/scripts/migrate.sh || warn "migrate failed"; fi
  "$INSTALL_ROOT/backend/.venv/bin/pip" install -q -r "$INSTALL_ROOT/backend/agent/requirements.txt" || true
  # Backfill WEB_INTERNAL_PORT for pre-existing installs
  if ! grep -q '^WEB_INTERNAL_PORT=' /etc/autoscript/agent.env 2>/dev/null; then
    local p=$(( ( RANDOM % 20000 ) + 20000 ))
    echo "WEB_INTERNAL_PORT=$p" >> /etc/autoscript/agent.env
    say "Assigned internal web port $p"
  fi
  # Install/refresh the web systemd unit
  if [[ -f "$INSTALL_ROOT/backend/systemd/autoscript-web.service" ]]; then
    install -m 644 "$INSTALL_ROOT/backend/systemd/autoscript-web.service" /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable autoscript-web >/dev/null 2>&1 || true
  fi
  say "Rebuilding web UI"
  ensure_node22
  build_web_ui || warn "Web rebuild failed"
  restart_stack
  ok "Updated to latest main."
}

restart_services() { restart_stack; ok "Services restarted."; }

view_logs() {
  echo "1) agent   2) ssh-ws   3) bot   4) nginx   5) ip-limit"
  ask "Which log? " x
  case "$x" in
    1) journalctl -u autoscript-agent   -n 200 --no-pager ;;
    2) journalctl -u autoscript-ssh-ws  -n 200 --no-pager ;;
    3) journalctl -u autoscript-bot     -n 200 --no-pager ;;
    4) journalctl -u nginx              -n 200 --no-pager ;;
    5) journalctl -u autoscript-ip-limit -n 200 --no-pager ;;
    *) warn "Unknown choice" ;;
  esac
}

backup_now() {
  local ts out
  ts=$(date +%Y%m%d-%H%M%S)
  out="/root/autoscript-backup-${ts}.tar.gz"
  tar -czf "$out" "$CONF_DIR" /usr/local/etc/xray 2>/dev/null || true
  ok "Backup written: $out"
}

reset_bot() {
  ask "Telegram bot token (blank to disable): " t
  ask "Admin chat id: " c
  set_setting "bot.token"       "$t"
  set_setting "bot.adminChatId" "$c"
  set_setting "bot.enabled"     "$([[ -n "$t" ]] && echo 1 || echo 0)"
  systemctl restart autoscript-bot || true
  ok "Bot updated."
}

uninstall_all() {
  ask "Type UNINSTALL to confirm: " ans
  [[ "$ans" == "UNINSTALL" ]] || { warn "Cancelled."; return; }
  bash "$INSTALL_ROOT/backend/uninstall.sh"
}

# ---------- menu ----------
menu() {
  clear || true
  cat <<EOF
${BLD}${BLU}Autoscript Admin CLI${RST}
==============================
 1) Show status
 2) Reset admin username
 3) Reset admin password (blank = auto-generate)
 4) Change panel domain / TLS mode
 5) Change panel port  (random, avoids Cloudflare/Nginx VPN ports)
 6) Change panel secret path
 7) Change GitHub repo URL
 8) Update from GitHub (git pull + rebuild + restart)
 9) Restart services
10) View service logs
11) Backup /etc/autoscript + xray config
12) Set Telegram bot token / admin id
13) Uninstall panel
 0) Exit
EOF
  ask "Choose: " c
  case "$c" in
    1) show_status ;;
    2) reset_admin_user ;;
    3) reset_admin_password ;;
    4) change_panel_domain ;;
    5) change_panel_port ;;
    6) change_panel_path ;;
    7) change_repo_url ;;
    8) update_now ;;
    9) restart_services ;;
   10) view_logs ;;
   11) backup_now ;;
   12) reset_bot ;;
   13) uninstall_all; exit 0 ;;
    0) exit 0 ;;
    *) warn "Unknown option" ;;
  esac
  echo; ask "Press enter to return to menu…" _; menu
}

# ---------- non-interactive flags ----------
case "${1:-}" in
  status)         show_status ;;
  reset-user)     reset_admin_user ;;
  reset-pass)     reset_admin_password ;;
  set-domain)     change_panel_domain ;;
  set-port)       change_panel_port ;;
  set-path)       change_panel_path ;;
  set-repo)       change_repo_url ;;
  update)         update_now ;;
  restart)        restart_services ;;
  logs)           view_logs ;;
  backup)         backup_now ;;
  set-bot)        reset_bot ;;
  uninstall)      uninstall_all ;;
  ""|menu)        menu ;;
  *) echo "usage: autoscript [status|reset-user|reset-pass|set-domain|set-port|set-path|set-repo|update|restart|logs|backup|set-bot|uninstall]"; exit 1;;
esac
