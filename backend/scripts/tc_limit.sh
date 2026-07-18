#!/usr/bin/env bash
# tc HTB per-user speed limiter. Args: USERNAME UP_KBPS DN_KBPS
# 0 = unlimited (removes any existing class).
set -euo pipefail
USER=${1:?}; UP=${2:-0}; DN=${3:-0}
IFACE=$(ip route show default | awk '/default/ {print $5; exit}')
[[ -n "$IFACE" ]] || exit 0

CLASSID=$(printf '1:%x' $(( 0x10 + $(id -u "$USER" 2>/dev/null || echo 0) % 0xFFEF )))

# ensure root qdisc
tc qdisc show dev "$IFACE" | grep -q "htb 1:" || tc qdisc add dev "$IFACE" root handle 1: htb default 1

# remove existing class if any
tc class del dev "$IFACE" classid "$CLASSID" 2>/dev/null || true

if [[ "$DN" -gt 0 ]]; then
  tc class add dev "$IFACE" parent 1: classid "$CLASSID" htb rate "${DN}kbit" ceil "${DN}kbit"
fi
echo "tc_limit: $USER  up=${UP}kbps dn=${DN}kbps class=$CLASSID iface=$IFACE"
