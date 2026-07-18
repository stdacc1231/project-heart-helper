#!/usr/bin/env bash
# Autoscript admin CLI — small on-VPS menu.
# Installed as /usr/local/bin/autoscript.
set -euo pipefail

RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; BLU=$'\e[36m'; BLD=$'\e[1m'; RST=$'\e[0m'
say(){ printf '%s\n' "${BLU}==>${RST} $*"; }
ok(){  printf '%s\n' "${GRN}[ok]${RST} $*"; }
warn(){printf '%s\n' "${YLW}[warn]${RST} $*"; }
die(){ printf '%s\n' "${RED}[err]${RST} $*" >&2; exit 1; }

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
  systemctl restart autoscript-agent autoscript-ssh-ws autoscript-bot 2>/dev/null || true
  systemctl reload nginx 2>/dev/null || systemctl restart nginx || true
}

# ---------- actions ----------
show_status() {
  echo
  echo "${BLD}Panel${RST}       : https://${PANEL_DOMAIN}:${PANEL_PORT}"
  echo "${BLD}Admin user${RST}  : ${ADMIN_USER}"
  echo "${BLD}DB${RST}          : ${DB_PATH}"
  echo "${BLD}Repo${RST}        : ${REPO_URL:-<none>}"
  echo "${BLD}Install dir${RST} : ${INSTALL_ROOT}"
  echo
  for u in autoscript-agent autoscript-ssh-ws autoscript-bot nginx; do
    printf "  %-22s %s\n" "$u" "$(systemctl is-active "$u" 2>/dev/null || echo inactive)"
  done
  echo
}

reset_admin_user() {
  read -rp "New admin username [$ADMIN_USER]: " u
  u=${u:-$ADMIN_USER}
  [[ "$u" =~ ^[a-zA-Z0-9_.-]{2,32}$ ]] || die "Invalid username."
  set_env ADMIN_USER "$u"
  set_setting "admin.username" "$u"
  restart_stack
  ok "Admin username set to '$u'."
}

reset_admin_password() {
  read -rsp "New admin password: " p1; echo
  read -rsp "Repeat password : " p2; echo
  [[ "$p1" == "$p2" && ${#p1} -ge 6 ]] || die "Passwords do not match or too short (min 6)."
  local hash
  hash=$("$VENV_PY" -c "from passlib.hash import bcrypt; import sys; print(bcrypt.hash(sys.argv[1]))" "$p1")
  set_env ADMIN_HASH "'$hash'"
  set_setting "admin.hash" "$hash"
  restart_stack
  ok "Admin password updated."
}

change_panel_domain() {
  read -rp "New panel domain (current: $PANEL_DOMAIN): " d
  [[ -n "$d" ]] || die "Domain required."
  read -rp "HTTPS port [${PANEL_PORT}]: " port
  port=${port:-$PANEL_PORT}
  echo "TLS mode:  1) single-domain  2) wildcard"
  read -rp "Choose [1-2, current mode kept if blank]: " mode
  set_env PANEL_DOMAIN "$d"
  set_env PANEL_PORT   "$port"
  set_setting "panel.domain" "$d"
  set_setting "panel.port"   "$port"
  [[ "$mode" == "1" ]] && set_setting "panel.tlsMode" "single"
  [[ "$mode" == "2" ]] && set_setting "panel.tlsMode" "wildcard"
  say "Re-issuing TLS + reloading nginx…"
  bash "$INSTALL_ROOT/backend/scripts/apply_settings.sh"
  restart_stack
  ok "Panel domain is now https://${d}:${port}"
}

change_repo_url() {
  read -rp "New GitHub repo URL [${REPO_URL:-none}]: " r
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
  restart_stack
  ok "Updated to latest main."
}

restart_services() { restart_stack; ok "Services restarted."; }

view_logs() {
  echo "1) agent   2) ssh-ws   3) bot   4) nginx   5) ip-limit"
  read -rp "Which log? " x
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
  read -rp "Telegram bot token (blank to disable): " t
  read -rp "Admin chat id: " c
  set_setting "bot.token"       "$t"
  set_setting "bot.adminChatId" "$c"
  set_setting "bot.enabled"     "$([[ -n "$t" ]] && echo 1 || echo 0)"
  systemctl restart autoscript-bot || true
  ok "Bot updated."
}

uninstall_all() {
  read -rp "Type UNINSTALL to confirm: " ans
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
 3) Reset admin password
 4) Change panel domain / port / TLS mode
 5) Change GitHub repo URL
 6) Update from GitHub (git pull + restart)
 7) Restart services
 8) View service logs
 9) Backup /etc/autoscript + xray config
10) Set Telegram bot token / admin id
11) Uninstall panel
 0) Exit
EOF
  read -rp "Choose: " c
  case "$c" in
    1) show_status ;;
    2) reset_admin_user ;;
    3) reset_admin_password ;;
    4) change_panel_domain ;;
    5) change_repo_url ;;
    6) update_now ;;
    7) restart_services ;;
    8) view_logs ;;
    9) backup_now ;;
   10) reset_bot ;;
   11) uninstall_all; exit 0 ;;
    0) exit 0 ;;
    *) warn "Unknown option" ;;
  esac
  echo; read -rp "Press enter to return to menu…" _; menu
}

# ---------- non-interactive flags ----------
case "${1:-}" in
  status)         show_status ;;
  reset-user)     reset_admin_user ;;
  reset-pass)     reset_admin_password ;;
  set-domain)     change_panel_domain ;;
  set-repo)       change_repo_url ;;
  update)         update_now ;;
  restart)        restart_services ;;
  logs)           view_logs ;;
  backup)         backup_now ;;
  set-bot)        reset_bot ;;
  uninstall)      uninstall_all ;;
  ""|menu)        menu ;;
  *) echo "usage: autoscript [status|reset-user|reset-pass|set-domain|set-repo|update|restart|logs|backup|set-bot|uninstall]"; exit 1;;
esac
