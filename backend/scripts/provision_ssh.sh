#!/usr/bin/env bash
# Provision an SSH user. Env: USERNAME (panel user), SYSTEM_USERNAME (Linux user), PASSWORD, EXPIRES (ISO date)
# Non-essential steps (banner, sshd reload) never fail the whole run.
set -u
: "${USERNAME:?USERNAME is required}"
: "${PASSWORD:?PASSWORD is required}"
: "${EXPIRES:?EXPIRES is required}"

SYSUSER="${SYSTEM_USERNAME:-grvpn-${USERNAME}}"
EXPIRE_DAY="$(date -d "$EXPIRES" +%F 2>/dev/null || echo '')"
if [ -z "$EXPIRE_DAY" ]; then
  # Fall back to ISO prefix if `date -d` can't parse the value.
  EXPIRE_DAY="${EXPIRES:0:10}"
fi

# ---- soft steps (banner shell, banner file, sshd banner directive) --------
{
  if [ ! -x /usr/local/bin/grvpn-motd ]; then
    cat >/usr/local/bin/grvpn-motd <<'MOTD'
#!/usr/bin/env bash
TOKEN_FILE="/etc/autoscript/agent.env"
TOKEN=""; PORT=""
if [ -r "$TOKEN_FILE" ]; then
  TOKEN=$(grep -E '^BOT_INTERNAL_TOKEN=' "$TOKEN_FILE" | tail -n1 | cut -d= -f2- | tr -d '"'"'"'')
  PORT=$(grep -E '^AGENT_PORT=' "$TOKEN_FILE" | tail -n1 | cut -d= -f2- | tr -d '"'"'"'')
fi
[ -z "$PORT" ] && PORT=8443
USER_NAME="${USER:-$(whoami)}"
HTML=$(curl -fsSk --max-time 3 -H "X-Internal-Token: ${TOKEN}" \
       "https://127.0.0.1:${PORT}/internal/motd?username=${USER_NAME}" 2>/dev/null \
       | sed -n 's/.*"html":"\(.*\)","variables.*/\1/p; s/.*"html":"\(.*\)"}.*/\1/p' \
       | sed 's/\\n/\n/g; s/\\"/"/g; s/\\\//\//g')
if [ -z "$HTML" ] && [ -r /etc/grvpn-ssh-banner.html ]; then
  HTML=$(cat /etc/grvpn-ssh-banner.html)
fi
printf '%s\n' "$HTML" | sed -e 's/<br[^>]*>/\n/gI' -e 's/<\/h[1-6]>/\n/gI' -e 's/<[^>]*>//g' -e '/^\s*$/d'
sleep 2
exit 0
MOTD
    chmod 0755 /usr/local/bin/grvpn-motd || true
  fi
  if ! grep -qx '/usr/local/bin/grvpn-motd' /etc/shells 2>/dev/null; then
    echo '/usr/local/bin/grvpn-motd' >> /etc/shells || true
  fi
  if [ ! -f /etc/grvpn-ssh-banner.html ]; then
    cat >/etc/grvpn-ssh-banner.html <<'BANNER'
<div style="text-align:center;">
    <h4>GR VPN SSH</h4>
</div>
BANNER
  fi
  if ! grep -q '^Banner /etc/grvpn-ssh-banner.html' /etc/ssh/sshd_config 2>/dev/null; then
    sed -i '/^Banner /d' /etc/ssh/sshd_config 2>/dev/null || true
    printf '\nBanner /etc/grvpn-ssh-banner.html\n' >> /etc/ssh/sshd_config 2>/dev/null || true
  fi
} 2>/dev/null || true

# ---- ESSENTIAL: user create / update + password ---------------------------
# Prefer the panel banner shell; fall back to /bin/false if not registered as a valid shell.
SHELL_PATH=/usr/local/bin/grvpn-motd
if ! grep -qx "$SHELL_PATH" /etc/shells 2>/dev/null; then
  SHELL_PATH=/bin/false
fi

if id "$SYSUSER" >/dev/null 2>&1; then
  usermod -s "$SHELL_PATH" -e "$EXPIRE_DAY" -c "GRVPN panel:${USERNAME}" "$SYSUSER" \
    || { echo "usermod failed for $SYSUSER" >&2; exit 1; }
else
  useradd -m -s "$SHELL_PATH" -e "$EXPIRE_DAY" -c "GRVPN panel:${USERNAME}" "$SYSUSER" \
    || useradd -m -s /bin/false -e "$EXPIRE_DAY" -c "GRVPN panel:${USERNAME}" "$SYSUSER" \
    || { echo "useradd failed for $SYSUSER" >&2; exit 1; }
fi

echo "${SYSUSER}:${PASSWORD}" | chpasswd \
  || { echo "chpasswd failed for $SYSUSER" >&2; exit 1; }

# Reload SSH so the banner change is picked up; never fatal.
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true

# ---- Per-user byte accounting via iptables owner match --------------------
# Chain name is AS_<panel-username> (truncated to 20 chars, matching agent).
UID_NUM="$(id -u "$SYSUSER" 2>/dev/null || echo '')"
if [ -n "$UID_NUM" ]; then
  CHAIN="AS_${USERNAME:0:20}"
  iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN" 2>/dev/null || true
  # OWNER match is only available in OUTPUT, so we tag the OUT side (server → client = download for the user).
  iptables -C OUTPUT -m owner --uid-owner "$UID_NUM" -j "$CHAIN" 2>/dev/null \
    || iptables -A OUTPUT -m owner --uid-owner "$UID_NUM" -j "$CHAIN" 2>/dev/null || true
  # For symmetry we also add a rough IN rule matched by conntrack owner (best-effort).
  iptables -C INPUT -m conntrack --ctstate ESTABLISHED -m owner --uid-owner "$UID_NUM" -j "$CHAIN" 2>/dev/null \
    || iptables -A INPUT -m conntrack --ctstate ESTABLISHED -m owner --uid-owner "$UID_NUM" -j "$CHAIN" 2>/dev/null || true
fi

echo "provisioned ssh user $SYSUSER for panel user $USERNAME (expires $EXPIRE_DAY)"
exit 0

