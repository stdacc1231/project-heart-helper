#!/usr/bin/env bash
set -euo pipefail
: "${USERNAME:?}"; : "${UUID:?}"
XRAY_CFG="/usr/local/etc/xray/config.json"
if ! command -v xray >/dev/null 2>&1 || [[ ! -f "$XRAY_CFG" ]]; then
  bash "$(dirname "$0")/setup_xray.sh"
fi
python3 "$(dirname "$0")/xray_client.py" add trojan
xray run -test -config "$XRAY_CFG" >/dev/null 2>&1 || xray -test -config "$XRAY_CFG" >/dev/null
systemctl restart xray
