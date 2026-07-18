#!/usr/bin/env bash
# Revoke an SSH user.
set -euo pipefail
USER=${1:?}
SYSUSER="${SYSTEM_USERNAME:-grvpn-${USER}}"
pkill -KILL -u "$SYSUSER" 2>/dev/null || true
userdel -r "$SYSUSER" 2>/dev/null || true
echo "revoked ssh user $SYSUSER for panel user $USER"
