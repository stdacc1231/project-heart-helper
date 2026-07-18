#!/usr/bin/env bash
# Revoke an SSH user.
set -euo pipefail
USER=${1:?}
pkill -KILL -u "$USER" 2>/dev/null || true
userdel -r "$USER" 2>/dev/null || true
echo "revoked ssh user $USER"
