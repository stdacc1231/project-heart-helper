#!/usr/bin/env bash
# Provision an SSH user. Env: USERNAME, PASSWORD, EXPIRES (ISO date)
set -euo pipefail
: "${USERNAME:?}"; : "${PASSWORD:?}"; : "${EXPIRES:?}"
EXPIRE_DAY=$(date -d "$EXPIRES" +%F)
useradd -m -s /bin/false -e "$EXPIRE_DAY" "$USERNAME" 2>/dev/null || usermod -e "$EXPIRE_DAY" "$USERNAME"
echo "${USERNAME}:${PASSWORD}" | chpasswd
echo "provisioned ssh user $USERNAME (expires $EXPIRE_DAY)"
