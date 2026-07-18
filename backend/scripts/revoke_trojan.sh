#!/usr/bin/env bash
set -euo pipefail
USER=${1:?}
export USERNAME="$USER"
XRAY_CFG="/usr/local/etc/xray/config.json"
[[ -f "$XRAY_CFG" ]] || exit 0
python3 "$(dirname "$0")/xray_client.py" remove trojan
xray -test -config "$XRAY_CFG" >/dev/null && systemctl restart xray || true
