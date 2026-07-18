#!/usr/bin/env bash
# Enforce per-user IP limit for SSH sessions. xray IP limits enforced by the
# agent via the xray stats API. Runs every 15s from a systemd timer.
set -euo pipefail
# shellcheck disable=SC1091
source /etc/autoscript/agent.env
DB="$DB_PATH"

# Pull SSH accounts with a non-zero ipLimit
mapfile -t ROWS < <(sqlite3 -separator '|' "$DB" \
  "SELECT username, ip_limit FROM accounts WHERE protocol='ssh' AND ip_limit>0;" 2>/dev/null || true)

ssh_user() {
  local base raw hash
  base=$(printf '%s' "$1" | sed 's/[^A-Za-z0-9_-]/-/g')
  [[ -n "$base" ]] || base=user
  raw="grvpn-${base}"
  if [[ ${#raw} -le 32 ]]; then printf '%s' "$raw"; return; fi
  hash=$(printf '%s' "$base" | sha256sum | awk '{print substr($1,1,8)}')
  printf 'grvpn-%s-%s' "${base:0:17}" "$hash"
}

for row in "${ROWS[@]}"; do
  panel_user="${row%%|*}"; limit="${row##*|}"; user=$(ssh_user "$panel_user")
  id -u "$user" >/dev/null 2>&1 || continue
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
