# Autoscript — Nginx template.
# Rendered by apply_settings.sh. Placeholders (documented without literal tokens
# so awk/sed do not touch them):
#   SERVER_NAMES   -> space-separated panel domain + per-protocol hosts
#   TLS_LISTENS    -> listen directives for every TLS/CF port
#   PLAIN_LISTENS  -> listen directives for every plain/CF port
#   ROOT / CERT    -> install and cert paths
#
# Nginx here handles ONLY the VPN protocols on Cloudflare-supported ports:
#   - SSH-over-WebSocket on path "/"  (HTTP/1.1, plain + TLS)
#   - xray VMess/VLESS/Trojan WebSocket paths
# The web panel is served directly by the Python agent on a separate random
# port with its own TLS — nothing panel-related passes through Nginx.

map $http_upgrade $is_ws { default 0; websocket 1; }

set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;
real_ip_header CF-Connecting-IP;
real_ip_recursive on;

# Basic rate limiting for WebSocket handshakes (fail2ban hooks into this).
limit_req_zone $binary_remote_addr zone=vpn_ws:10m rate=30r/s;

# ---------------- Plain HTTP (Cloudflare plain / orange-cloud) --------------
server {
__PLAIN_LISTENS__
    server_name __SERVER_NAMES__;
    client_max_body_size 1m;

    # SSH-WS on "/" (plain WebSocket path — HTTP/1.1)
    location = / {
        if ($is_ws) { rewrite ^ /__ws last; }
        return 404;
    }
    location /__ws {
        internal;
        limit_req  zone=vpn_ws burst=60 nodelay;
        proxy_pass         http://127.0.0.1:2095;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_read_timeout 7d; proxy_send_timeout 7d;
    }

    # xray VMess/VLESS/Trojan WS on plain (some CDN plans use only plain WS)
    location /vmess  { limit_req zone=vpn_ws burst=60 nodelay;
        proxy_pass http://127.0.0.1:10001; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }
    location /vless  { limit_req zone=vpn_ws burst=60 nodelay;
        proxy_pass http://127.0.0.1:10002; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }
    location /trojan { limit_req zone=vpn_ws burst=60 nodelay;
        proxy_pass http://127.0.0.1:10003; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }

    location / { return 404; }
    access_log /var/log/nginx/autoscript-access.log;
    error_log  /var/log/nginx/autoscript-error.log;
}

# ---------------- TLS (Cloudflare-supported TLS ports) ----------------------
server {
__TLS_LISTENS__
    server_name __SERVER_NAMES__;

    ssl_certificate     __CERT__/fullchain.pem;
    ssl_certificate_key __CERT__/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    client_max_body_size 1m;

    # SSH over WebSocket on "/" (HTTP/1.1, no random path)
    location = / {
        if ($is_ws) { rewrite ^ /__ws last; }
        return 404;
    }
    location /__ws {
        internal;
        limit_req  zone=vpn_ws burst=60 nodelay;
        proxy_pass         http://127.0.0.1:2095;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_read_timeout 7d; proxy_send_timeout 7d;
    }

    # xray WS paths
    location /vmess  { limit_req zone=vpn_ws burst=60 nodelay;
        proxy_pass http://127.0.0.1:10001; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }
    location /vless  { limit_req zone=vpn_ws burst=60 nodelay;
        proxy_pass http://127.0.0.1:10002; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }
    location /trojan { limit_req zone=vpn_ws burst=60 nodelay;
        proxy_pass http://127.0.0.1:10003; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }

    location / { return 404; }
    access_log /var/log/nginx/autoscript-access.log;
    error_log  /var/log/nginx/autoscript-error.log;
}
