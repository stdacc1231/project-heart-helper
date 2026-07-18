#!/usr/bin/env bash
# tc-based per-user speed limiter. Called by the agent on account create/edit.
# Usage: tc_limit.sh <username> <kbps>   (kbps=0 removes any existing limit)
set -euo pipefail
USER=${1:?}; KBPS=${2:-0}
IFACE=$(ip route show default | awk '/default/ {print $5; exit}')
UID_NUM=$(id -u "$USER" 2>/dev/null || echo "")

# Ensure root qdisc exists
tc qdisc show dev "$IFACE" | grep -q htb || tc qdisc add dev "$IFACE" root handle 1: htb default 30

# Stable classid derived from the linux uid (fallback to hash of username)
if [[ -z "$UID_NUM" ]]; then
  UID_NUM=$(( $(printf '%s' "$USER" | cksum | awk '{print $1}') % 60000 + 1000 ))
fi
CLASSID=$((UID_NUM % 65000 + 100))

# Remove existing rules for this class
tc filter del dev "$IFACE" pref "$CLASSID" 2>/dev/null || true
tc class  del dev "$IFACE" classid 1:"$CLASSID" 2>/dev/null || true

if [[ "$KBPS" -gt 0 ]]; then
  tc class add dev "$IFACE" parent 1: classid 1:"$CLASSID" htb rate "${KBPS}kbit" ceil "${KBPS}kbit"
  # Match traffic owned by this user (egress). Ingress limiting would need ifb.
  tc filter add dev "$IFACE" protocol ip parent 1: prio "$CLASSID" \
     handle "$UID_NUM" fw flowid 1:"$CLASSID"
  # Mark packets from this uid
  iptables -t mangle -C OUTPUT -m owner --uid-owner "$USER" -j MARK --set-mark "$UID_NUM" 2>/dev/null \
    || iptables -t mangle -A OUTPUT -m owner --uid-owner "$USER" -j MARK --set-mark "$UID_NUM"
  echo "limited $USER to ${KBPS}kbps on $IFACE"
else
  iptables -t mangle -D OUTPUT -m owner --uid-owner "$USER" -j MARK --set-mark "$UID_NUM" 2>/dev/null || true
  echo "removed limit for $USER"
fi
