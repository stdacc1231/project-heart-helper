#!/usr/bin/env bash
set -euo pipefail
USER=${1:?}
echo "revoke $USER from xray — TODO"
systemctl reload xray 2>/dev/null || true
