#!/usr/bin/env bash
# Install and configure xray-core with three inbounds (VMess/VLESS/Trojan)
# behind Nginx on 127.0.0.1. Nginx handles TLS on the Cloudflare ports and
# routes WS paths /vmess, /vless, /trojan to the local ports below.
set -euo pipefail

XRAY_CFG_DIR="/usr/local/etc/xray"
XRAY_CFG="${XRAY_CFG_DIR}/config.json"
LOG_DIR="/var/log/xray"

xray_test() {
  xray run -test -config "$XRAY_CFG" >/dev/null 2>&1 || xray -test -config "$XRAY_CFG" >/dev/null 2>&1
}

# 1) Install xray-core. Try the official installer first, then a direct
# GitHub release fallback so old VPS images still self-heal during update.
install_xray_fallback() {
  local arch asset tmp
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) asset="Xray-linux-64.zip" ;;
    aarch64|arm64) asset="Xray-linux-arm64-v8a.zip" ;;
    armv7l|armv7*) asset="Xray-linux-arm32-v7a.zip" ;;
    *) echo "[xray] unsupported CPU arch: $arch" >&2; return 1 ;;
  esac
  tmp="$(mktemp -d)"
  curl -fL "https://github.com/XTLS/Xray-core/releases/latest/download/${asset}" -o "$tmp/xray.zip"
  unzip -qo "$tmp/xray.zip" -d "$tmp/xray"
  install -m 755 "$tmp/xray/xray" /usr/local/bin/xray
  mkdir -p /usr/local/share/xray
  [[ -f "$tmp/xray/geoip.dat" ]] && install -m 644 "$tmp/xray/geoip.dat" /usr/local/share/xray/geoip.dat
  [[ -f "$tmp/xray/geosite.dat" ]] && install -m 644 "$tmp/xray/geosite.dat" /usr/local/share/xray/geosite.dat
  rm -rf "$tmp"
}

if ! command -v xray >/dev/null 2>&1; then
  echo "[xray] installing xray-core"
  if ! bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install; then
    echo "[xray] official installer failed, trying direct release fallback"
    install_xray_fallback
  fi
fi

cat >/etc/systemd/system/xray.service <<'EOF'
[Unit]
Description=Xray Service
Documentation=https://github.com/xtls
After=network.target nss-lookup.target

[Service]
User=root
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ExecStart=/usr/local/bin/xray run -config /usr/local/etc/xray/config.json
Restart=on-failure
RestartPreventExitStatus=23
LimitNPROC=10000
LimitNOFILE=1000000

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

mkdir -p "$XRAY_CFG_DIR" "$LOG_DIR"

# 2) Always normalize the config so upgrades repair old/broken templates while
# keeping existing VMess/VLESS/Trojan users.
python3 - "$XRAY_CFG" <<'PY'
import json, sys
from pathlib import Path

cfg_path = Path(sys.argv[1])
old = {}
if cfg_path.exists() and cfg_path.stat().st_size:
    try:
        old = json.loads(cfg_path.read_text())
    except Exception:
        old = {}

def clients(tag):
    for inbound in old.get("inbounds", []):
        if inbound.get("tag") == tag:
            return inbound.get("settings", {}).get("clients", []) or []
    return []

cfg = {
  "log": {"loglevel": "warning", "access": "/var/log/xray/access.log", "error": "/var/log/xray/error.log"},
  "api": {"tag": "api", "services": ["StatsService"]},
  "stats": {},
  "policy": {
    "levels": {"0": {"statsUserUplink": True, "statsUserDownlink": True}},
    "system": {"statsInboundUplink": True, "statsInboundDownlink": True},
  },
  "inbounds": [
    {
      "tag": "api-in", "listen": "127.0.0.1", "port": 10085, "protocol": "dokodemo-door",
      "settings": {"address": "127.0.0.1", "port": 10085, "network": "tcp"},
    },
    {
      "tag": "vmess-ws", "listen": "127.0.0.1", "port": 10001, "protocol": "vmess",
      "settings": {"clients": clients("vmess-ws")},
      "streamSettings": {"network": "ws", "wsSettings": {"path": "/vmess"}},
    },
    {
      "tag": "vless-ws", "listen": "127.0.0.1", "port": 10002, "protocol": "vless",
      "settings": {"clients": clients("vless-ws"), "decryption": "none"},
      "streamSettings": {"network": "ws", "wsSettings": {"path": "/vless"}},
    },
    {
      "tag": "trojan-ws", "listen": "127.0.0.1", "port": 10003, "protocol": "trojan",
      "settings": {"clients": clients("trojan-ws")},
      "streamSettings": {"network": "ws", "wsSettings": {"path": "/trojan"}},
    },
  ],
  "outbounds": [
    {"protocol": "freedom", "tag": "direct"},
    {"protocol": "blackhole", "tag": "block"},
  ],
  "routing": {"rules": [{"type": "field", "inboundTag": ["api-in"], "outboundTag": "api"}]},
}
cfg_path.write_text(json.dumps(cfg, indent=2) + "\n")
PY

# 3) Validate + start.
if xray_test; then
  systemctl enable --now xray
  systemctl restart xray
  echo "[xray] running"
else
  echo "[xray] config test failed — leaving service stopped" >&2
  xray run -test -config "$XRAY_CFG" || xray -test -config "$XRAY_CFG" || true
  exit 1
fi
