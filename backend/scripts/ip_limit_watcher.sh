#!/usr/bin/env bash
# Enforce per-user IP limit for SSH sessions. xray IP limits enforced by the
# agent via the xray stats API. Runs every 15s from a systemd timer.
set -euo pipefail
# shellcheck disable=SC1091
source /etc/autoscript/agent.env
DB="$DB_PATH"

# Pull SSH accounts with a non-zero ipLimit
mapfile -t ROWS < <(sqlite3 -separator '|' "$DB" \
  "SELECT username, ipLimit FROM accounts WHERE protocol='ssh' AND ipLimit>0;" 2>/dev/null || true)

for row in "${ROWS[@]}"; do
  user="${row%%|*}"; limit="${row##*|}"
  # distinct client IPs currently connected via sshd for this user
  mapfile -t ips < <(ss -tnp 2>/dev/null | awk -v u="$user" '
    $0 ~ ("users:\\(\\(\"sshd\",pid=") { split($5,a,":"); print a[1] }' | sort -u)
  n=${#ips[@]}
  if (( n > limit )); then
    # kill excess sshd pids owned by the user (newest first)
    pids=$(pgrep -u "$user" sshd | tac)
    kill_n=$(( n - limit ))
    for pid in $pids; do
      (( kill_n-- <= 0 )) && break
      kill -HUP "$pid" 2>/dev/null || true
    done
    logger -t autoscript-iplimit "ssh:$user over limit ($n>$limit), disconnected extras"
  fi
done
