#!/usr/bin/env bash
set -euo pipefail
: "${USERNAME:?}"; : "${UUID:?}"
XRAY_CFG="/usr/local/etc/xray/config.json"
[[ -f "$XRAY_CFG" ]] || bash "$(dirname "$0")/setup_xray.sh"
python3 "$(dirname "$0")/xray_client.py" add vmess
xray -test -config "$XRAY_CFG" >/dev/null
systemctl restart xray
