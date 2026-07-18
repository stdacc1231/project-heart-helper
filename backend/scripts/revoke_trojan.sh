#!/usr/bin/env bash
set -euo pipefail
USER=${1:?}
export USERNAME="$USER"
XRAY_CFG="/usr/local/etc/xray/config.json"
[[ -f "$XRAY_CFG" ]] || exit 0
python3 "$(dirname "$0")/xray_client.py" remove trojan
xray run -test -config "$XRAY_CFG" >/dev/null 2>&1 || xray -test -config "$XRAY_CFG" >/dev/null && systemctl restart xray || true
