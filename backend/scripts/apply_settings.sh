#!/usr/bin/env bash
# Re-render nginx vhost from DB settings, extend cert with any new hosts, reload.
set -euo pipefail
# shellcheck disable=SC1091
source /etc/autoscript/agent.env
DB="$DB_PATH"

q() { sqlite3 "$DB" "SELECT value FROM settings WHERE key='$1';"; }
list_kv_prefix() { sqlite3 "$DB" "SELECT key,value FROM settings WHERE key LIKE '$1%';"; }

DOMAIN=$(q panel.domain); [[ -z "$DOMAIN" ]] && DOMAIN="$PANEL_DOMAIN"
TLS_PORTS=$(q panel.tlsPorts);   [[ -z "$TLS_PORTS"   ]] && TLS_PORTS="443,2053,2083,2087,2096,8443"
PLAIN_PORTS=$(q panel.plainPorts); [[ -z "$PLAIN_PORTS" ]] && PLAIN_PORTS="80,8080,8880,2052,2082,2086,2095"

# Collect protocol host overrides -> unique server_name list
EXTRA_HOSTS=""
while IFS='|' read -r k v; do
  [[ -z "$v" ]] && continue
  case "$EXTRA_HOSTS" in *" $v "*) ;; *) EXTRA_HOSTS="$EXTRA_HOSTS $v " ;; esac
done < <(sqlite3 -separator '|' "$DB" "SELECT key,value FROM settings WHERE key LIKE 'hosts.%';")
SERVER_NAMES="$DOMAIN$EXTRA_HOSTS"

# Build listen directives
TLS_LISTENS=""
for p in ${TLS_PORTS//,/ }; do
  TLS_LISTENS="$TLS_LISTENS    listen $p ssl http2;\n    listen [::]:$p ssl http2;\n"
done
PLAIN_LISTENS=""
for p in ${PLAIN_PORTS//,/ }; do
  PLAIN_LISTENS="$PLAIN_LISTENS    listen $p;\n    listen [::]:$p;\n"
done

# Extend/issue cert to cover panel + all extra hosts
ACME=~/.acme.sh/acme.sh
if [[ -x "$ACME" ]]; then
  DARGS="-d $DOMAIN"
  for h in $EXTRA_HOSTS; do DARGS="$DARGS -d $h"; done
  # Only re-issue when host set changed vs. previous marker
  MARKER=/etc/autoscript/certs/.hosts
  CUR="$(echo "$DARGS" | tr -s ' ')"
  [[ -f "$MARKER" && "$(cat "$MARKER")" == "$CUR" ]] || {
    if [[ "$(q panel.tlsMode)" == "wildcard" ]]; then
      "$ACME" --issue --dns "$(q panel.dnsProvider)" -d "$(q panel.rootDomain)" -d "*.$(q panel.rootDomain)" --keylength ec-256 --force || true
    else
      systemctl stop nginx 2>/dev/null || true
      # shellcheck disable=SC2086
      "$ACME" --issue --standalone $DARGS --keylength ec-256 --force || true
    fi
    "$ACME" --install-cert -d "$DOMAIN" --ecc \
      --fullchain-file /etc/autoscript/certs/fullchain.pem \
      --key-file       /etc/autoscript/certs/privkey.pem \
      --reloadcmd     'systemctl reload nginx && systemctl restart xray || true' || true
    echo "$CUR" > "$MARKER"
  }
fi

TMP=$(mktemp)
sed \
  -e "s|__SERVER_NAMES__|${SERVER_NAMES}|g" \
  -e "s|__ROOT__|${INSTALL_ROOT}|g" \
  -e "s|__CERT__|/etc/autoscript/certs|g" \
  "$INSTALL_ROOT/backend/nginx/panel.conf.tpl" > "$TMP"
# Expand the \n placeholders
awk -v tls="$TLS_LISTENS" -v plain="$PLAIN_LISTENS" '
  { gsub(/__TLS_LISTENS__/, tls); gsub(/__PLAIN_LISTENS__/, plain); print }
' "$TMP" | sed 's/\\n/\n/g' > /etc/nginx/sites-available/autoscript-panel.conf
rm -f "$TMP"
ln -sf /etc/nginx/sites-available/autoscript-panel.conf /etc/nginx/sites-enabled/autoscript-panel.conf

nginx -t
systemctl reload-or-restart nginx
systemctl restart xray 2>/dev/null || true
echo "apply_settings: domain=$DOMAIN hosts='$EXTRA_HOSTS' tls=$TLS_PORTS plain=$PLAIN_PORTS"
