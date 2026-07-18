#!/usr/bin/env bash
# Install and configure xray-core with three inbounds (VMess/VLESS/Trojan)
# behind Nginx on 127.0.0.1. Nginx handles TLS on the Cloudflare ports and
# routes WS paths /vmess, /vless, /trojan to the local ports below.
set -euo pipefail

XRAY_CFG_DIR="/usr/local/etc/xray"
XRAY_CFG="${XRAY_CFG_DIR}/config.json"
LOG_DIR="/var/log/xray"

# 1) Install xray (official installer). Idempotent.
if ! command -v xray >/dev/null 2>&1; then
  echo "[xray] installing xray-core"
  bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
fi

mkdir -p "$XRAY_CFG_DIR" "$LOG_DIR"

# 2) Write a minimal working config if one doesn't already exist. We keep the
# accounts array empty here — provision_*.sh scripts append clients later.
if [[ ! -s "$XRAY_CFG" ]]; then
  cat >"$XRAY_CFG" <<'JSON'
{
  "log": { "loglevel": "warning", "access": "/var/log/xray/access.log", "error": "/var/log/xray/error.log" },
  "api": { "tag": "api", "services": ["StatsService"] },
  "stats": {},
  "policy": {
    "levels": { "0": { "statsUserUplink": true, "statsUserDownlink": true } },
    "system": { "statsInboundUplink": true, "statsInboundDownlink": true }
  },
  "inbounds": [
    {
      "tag": "api-in",
      "listen": "127.0.0.1", "port": 10085, "protocol": "dokodemo-door",
      "settings": { "address": "127.0.0.1" }
    },
    {
      "tag": "vmess-ws",
      "listen": "127.0.0.1", "port": 10001, "protocol": "vmess",
      "settings": { "clients": [] },
      "streamSettings": { "network": "ws", "wsSettings": { "path": "/vmess" } }
    },
    {
      "tag": "vless-ws",
      "listen": "127.0.0.1", "port": 10002, "protocol": "vless",
      "settings": { "clients": [], "decryption": "none" },
      "streamSettings": { "network": "ws", "wsSettings": { "path": "/vless" } }
    },
    {
      "tag": "trojan-ws",
      "listen": "127.0.0.1", "port": 10003, "protocol": "trojan",
      "settings": { "clients": [] },
      "streamSettings": { "network": "ws", "wsSettings": { "path": "/trojan" } }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "block" }
  ],
  "routing": {
    "rules": [
      { "type": "field", "inboundTag": ["api-in"], "outboundTag": "api" }
    ]
  }
}
JSON
fi

# 3) Validate + start.
if xray -test -config "$XRAY_CFG" >/dev/null 2>&1; then
  systemctl enable --now xray
  systemctl restart xray
  echo "[xray] running"
else
  echo "[xray] config test failed — leaving service stopped" >&2
  xray -test -config "$XRAY_CFG" || true
  exit 1
fi
