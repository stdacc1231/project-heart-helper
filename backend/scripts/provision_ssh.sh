#!/usr/bin/env bash
# Provision an SSH user. Env: USERNAME (panel user), SYSTEM_USERNAME (Linux user), PASSWORD, EXPIRES (ISO date)
set -euo pipefail
: "${USERNAME:?}"; : "${PASSWORD:?}"; : "${EXPIRES:?}"
SYSUSER="${SYSTEM_USERNAME:-grvpn-${USERNAME}}"
EXPIRE_DAY=$(date -d "$EXPIRES" +%F)

# --- Per-user login shell: shows the panel banner (with live user stats) then exits.
# Port-forwarding clients (ssh -N / SSH-WS tunnels) never invoke the shell, so
# tunneling keeps working; interactive clients see the banner and disconnect.
if [ ! -x /usr/local/bin/grvpn-motd ]; then
  cat >/usr/local/bin/grvpn-motd <<'MOTD'
#!/usr/bin/env bash
# Render the per-user SSH MOTD from the panel's banner template.
TOKEN_FILE="/etc/autoscript/agent.env"
TOKEN=""
PORT=""
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
# Strip HTML tags for the terminal; keep line breaks.
printf '%s\n' "$HTML" | sed -e 's/<br[^>]*>/\n/gI' -e 's/<\/h[1-6]>/\n/gI' -e 's/<[^>]*>//g' -e '/^\s*$/d'
sleep 2
exit 0
MOTD
  chmod 0755 /usr/local/bin/grvpn-motd
fi
# Whitelist the login shell so `useradd -s` is accepted.
if ! grep -qx '/usr/local/bin/grvpn-motd' /etc/shells 2>/dev/null; then
  echo '/usr/local/bin/grvpn-motd' >> /etc/shells
fi

# --- Pre-auth banner (server-wide info). The panel agent refreshes this file
# every 5 minutes with live counters from the template stored in settings.
if [ ! -f /etc/grvpn-ssh-banner.html ]; then
  cat >/etc/grvpn-ssh-banner.html <<'BANNER'
<div style="text-align:center;">
    <h4><font color="#ffff">⚡️GR VPN SSH</font></h4>
    <h4><font color="green">⚡️Term of services</font></h4>
    <h3><font color="yellow">⚡️No Spam</font></h3>
    <h3><font color="#ffff">⚡️No Hacking</font></h3>
    <h3><font color="blue">⚡️No DDOS</font></h3>
    <h1><font color="#F6BE00">⚡️No Multi login, Auto delete</font></h1>
    <h3><font color="red">GR VPN</font></h3>
</div>
BANNER
fi
if ! grep -q '^Banner /etc/grvpn-ssh-banner.html' /etc/ssh/sshd_config 2>/dev/null; then
  sed -i '/^Banner /d' /etc/ssh/sshd_config 2>/dev/null || true
  printf '\nBanner /etc/grvpn-ssh-banner.html\n' >> /etc/ssh/sshd_config
fi

useradd -m -s /usr/local/bin/grvpn-motd -e "$EXPIRE_DAY" -c "GRVPN panel:${USERNAME}" "$SYSUSER" 2>/dev/null \
  || usermod -s /usr/local/bin/grvpn-motd -e "$EXPIRE_DAY" -c "GRVPN panel:${USERNAME}" "$SYSUSER"
echo "${SYSUSER}:${PASSWORD}" | chpasswd
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
echo "provisioned ssh user $SYSUSER for panel user $USERNAME (expires $EXPIRE_DAY)"
