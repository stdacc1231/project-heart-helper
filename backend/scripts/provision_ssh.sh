#!/usr/bin/env bash
# Provision an SSH user. Env: USERNAME (panel user), SYSTEM_USERNAME (Linux user), PASSWORD, EXPIRES (ISO date)
set -euo pipefail
: "${USERNAME:?}"; : "${PASSWORD:?}"; : "${EXPIRES:?}"
SYSUSER="${SYSTEM_USERNAME:-grvpn-${USERNAME}}"
EXPIRE_DAY=$(date -d "$EXPIRES" +%F)
install -m 644 /dev/stdin /etc/grvpn-ssh-banner.html <<'EOF'
<div style="text-align:center;">
    <h4><font color="#ffff">⚡️GR VPN SSH</font></h4>
    <h4><font color="green">⚡️Term of services</font></h4>
    <h3><font color="yellow">⚡️No Spam</font></h3>
    <h3><font color="#ffff">⚡️No Hacking</font></h3>
    <h3><font color="blue">⚡️No DDOS</font></h3>
    <h1><font color="#F6BE00">⚡️No Multi login, Auto delete</font></h1>
    <h3><font color="red">GR VPN</font></h3>
</div>
EOF
if ! grep -q '^Banner /etc/grvpn-ssh-banner.html' /etc/ssh/sshd_config 2>/dev/null; then
  sed -i '/^Banner /d' /etc/ssh/sshd_config 2>/dev/null || true
  printf '\nBanner /etc/grvpn-ssh-banner.html\n' >> /etc/ssh/sshd_config
fi
useradd -m -s /bin/false -e "$EXPIRE_DAY" -c "GRVPN panel:${USERNAME}" "$SYSUSER" 2>/dev/null || usermod -e "$EXPIRE_DAY" -c "GRVPN panel:${USERNAME}" "$SYSUSER"
echo "${SYSUSER}:${PASSWORD}" | chpasswd
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
echo "provisioned ssh user $SYSUSER for panel user $USERNAME (expires $EXPIRE_DAY)"
