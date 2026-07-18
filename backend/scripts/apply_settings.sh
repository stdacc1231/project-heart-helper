#!/usr/bin/env bash
# Re-apply Nginx + TLS after Settings page changes. Reads panel.* keys from DB.
set -euo pipefail
source /etc/autoscript/agent.env
DB="$DB_PATH"
q() { sqlite3 "$DB" "SELECT value FROM settings WHERE key='$1';"; }

DOMAIN=$(q panel.domain); [[ -z "$DOMAIN" ]] && DOMAIN="$PANEL_DOMAIN"
PORT=$(q panel.port);     [[ -z "$PORT"   ]] && PORT="$PANEL_PORT"
TLSM=$(q panel.tlsMode);  [[ -z "$TLSM"   ]] && TLSM="single"

sed -e "s|__DOMAIN__|${DOMAIN}|g; s|__PORT__|${PORT}|g; s|__ROOT__|${INSTALL_ROOT}|g; s|__CERT__|/etc/autoscript/certs|g" \
    "$INSTALL_ROOT/backend/nginx/panel.conf.tpl" > /etc/nginx/sites-available/autoscript-panel.conf

nginx -t && systemctl reload nginx
echo "apply_settings: domain=$DOMAIN port=$PORT tlsMode=$TLSM"
