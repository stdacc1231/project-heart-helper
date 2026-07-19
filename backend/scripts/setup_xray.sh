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

# 1) Install xray-core. Pass XRAY_VERSION=v1.8.24 (or "latest") to pin/downgrade.
XRAY_VERSION="${XRAY_VERSION:-}"
install_xray_fallback() {
  local arch asset tmp ver rel
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) asset="Xray-linux-64.zip" ;;
    aarch64|arm64) asset="Xray-linux-arm64-v8a.zip" ;;
    armv7l|armv7*) asset="Xray-linux-arm32-v7a.zip" ;;
    *) echo "[xray] unsupported CPU arch: $arch" >&2; return 1 ;;
  esac
  ver="${1:-latest}"
  if [[ "$ver" == "latest" || -z "$ver" ]]; then
    rel="latest/download"
  else
    rel="download/${ver}"
  fi
  tmp="$(mktemp -d)"
  curl -fL "https://github.com/XTLS/Xray-core/releases/${rel}/${asset}" -o "$tmp/xray.zip"
  unzip -qo "$tmp/xray.zip" -d "$tmp/xray"
  install -m 755 "$tmp/xray/xray" /usr/local/bin/xray
  mkdir -p /usr/local/share/xray
  [[ -f "$tmp/xray/geoip.dat" ]] && install -m 644 "$tmp/xray/geoip.dat" /usr/local/share/xray/geoip.dat
  [[ -f "$tmp/xray/geosite.dat" ]] && install -m 644 "$tmp/xray/geosite.dat" /usr/local/share/xray/geosite.dat
  rm -rf "$tmp"
}

if [[ -n "$XRAY_VERSION" ]]; then
  echo "[xray] installing xray-core ${XRAY_VERSION}"
  install_xray_fallback "$XRAY_VERSION"
elif ! command -v xray >/dev/null 2>&1; then
  echo "[xray] installing xray-core (latest)"
  if ! bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install; then
    echo "[xray] official installer failed, trying direct release fallback"
    install_xray_fallback "latest"
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

# The official installer may leave a hardening drop-in that changes the runtime
# user. That can block our managed log/config paths after upgrades, so normalize
# to this script's known-good unit each time repair/update runs.
rm -rf /etc/systemd/system/xray.service.d
systemctl daemon-reload

mkdir -p "$XRAY_CFG_DIR" "$LOG_DIR"
touch "$LOG_DIR/access.log" "$LOG_DIR/error.log"
chown -R root:root "$XRAY_CFG_DIR" "$LOG_DIR"
chmod 755 "$XRAY_CFG_DIR" "$LOG_DIR"
chmod 644 "$LOG_DIR/access.log" "$LOG_DIR/error.log"

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

def clients(*tags):
    """Return the client list from the first inbound tag that had users,
    so clients survive upgrades between transports."""
    for tag in tags:
        for inbound in old.get("inbounds", []):
            if inbound.get("tag") == tag:
                users = inbound.get("settings", {}).get("clients", []) or []
                if users:
                    return users
    return []

def ws_inbound(tag, port, proto, path, extra=None):
    settings = {"clients": clients(tag, f"{proto}-ws", f"{proto}-xh", f"{proto}-hu")}
    if proto == "vless":
        settings["decryption"] = "none"
    if extra:
        settings.update(extra)
    return {
        "tag": tag, "listen": "127.0.0.1", "port": port, "protocol": proto,
        "settings": settings,
        "streamSettings": {"network": "ws", "wsSettings": {"path": path},
            "sockopt": {"tcpFastOpen": True, "tcpNoDelay": True, "tcpKeepAliveInterval": 30}},
    }

def xh_inbound(tag, port, proto, path):
    settings = {"clients": clients(tag, f"{proto}-ws", f"{proto}-xh", f"{proto}-hu")}
    if proto == "vless":
        settings["decryption"] = "none"
    return {
        "tag": tag, "listen": "127.0.0.1", "port": port, "protocol": proto,
        "settings": settings,
        "streamSettings": {"network": "xhttp", "xhttpSettings": {"path": path, "mode": "auto"},
            "sockopt": {"tcpFastOpen": True, "tcpNoDelay": True}},
    }

def hu_inbound(tag, port, proto, path):
    settings = {"clients": clients(tag, f"{proto}-ws", f"{proto}-xh", f"{proto}-hu")}
    if proto == "vless":
        settings["decryption"] = "none"
    return {
        "tag": tag, "listen": "127.0.0.1", "port": port, "protocol": proto,
        "settings": settings,
        "streamSettings": {"network": "httpupgrade", "httpupgradeSettings": {"path": path},
            "sockopt": {"tcpFastOpen": True, "tcpNoDelay": True}},
    }

cfg = {
  "log": {"loglevel": "warning", "access": "/var/log/xray/access.log", "error": "/var/log/xray/error.log"},
  "api": {"tag": "api", "services": ["StatsService"]},
  "stats": {},
  "policy": {
    "levels": {"0": {"handshake": 2, "connIdle": 300, "uplinkOnly": 2, "downlinkOnly": 5,
                       "statsUserUplink": True, "statsUserDownlink": True,
                       "bufferSize": 4096}},
    "system": {"statsInboundUplink": True, "statsInboundDownlink": True},
  },
  "inbounds": [
    {
      "tag": "api-in", "listen": "127.0.0.1", "port": 10085, "protocol": "dokodemo-door",
      "settings": {"address": "127.0.0.1", "port": 10085, "network": "tcp"},
    },
    # WebSocket inbounds
    ws_inbound("vmess-ws",  10001, "vmess",  "/vmess"),
    ws_inbound("vless-ws",  10002, "vless",  "/vless"),
    ws_inbound("trojan-ws", 10003, "trojan", "/trojan"),
    # xHTTP inbounds
    xh_inbound("vmess-xh",  10011, "vmess",  "/vmess-xh"),
    xh_inbound("vless-xh",  10012, "vless",  "/vless-xh"),
    xh_inbound("trojan-xh", 10013, "trojan", "/trojan-xh"),
    # HTTPUpgrade inbounds
    hu_inbound("vmess-hu",  10021, "vmess",  "/vmess-hu"),
    hu_inbound("vless-hu",  10022, "vless",  "/vless-hu"),
    hu_inbound("trojan-hu", 10023, "trojan", "/trojan-hu"),
  ],
  "outbounds": [
    {"protocol": "freedom", "tag": "direct",
     "streamSettings": {"sockopt": {"tcpFastOpen": True, "tcpNoDelay": True}}},
    {"protocol": "blackhole", "tag": "block"},
  ],
  "routing": {"rules": [{"type": "field", "inboundTag": ["api-in"], "outboundTag": "api"}]},
}
cfg_path.write_text(json.dumps(cfg, indent=2) + "\n")
PY


# Kernel tuning: BBR + bigger buffers so xray/ssh saturate the link.
cat >/etc/sysctl.d/99-autoscript.conf <<'EOF'
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_notsent_lowat = 16384
net.ipv4.tcp_rmem = 4096 87380 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.core.netdev_max_backlog = 5000
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 8192
fs.file-max = 1000000
EOF
sysctl --system >/dev/null 2>&1 || true


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
