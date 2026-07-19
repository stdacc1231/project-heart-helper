# Autoscript — Nginx template.
# Rendered by apply_settings.sh. Placeholders (documented without literal tokens
# so awk/sed do not touch them):
#   SERVER_NAMES   -> space-separated panel domain + per-protocol hosts
#   TLS_LISTENS    -> listen directives for every TLS/CF port
#   PLAIN_LISTENS  -> listen directives for every plain/CF port
#   ROOT / CERT    -> install and cert paths
#
# Nginx handles ONLY the VPN protocols on Cloudflare-supported ports:
#   - SSH-over-WebSocket on path "/"  (HTTP/1.1, plain + TLS)
#   - xray VMess/VLESS/Trojan on WS, xHTTP and HTTPUpgrade transports
# The web panel runs on a separate random port with its own TLS.

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

limit_req_zone $binary_remote_addr zone=vpn_ws:10m rate=30r/s;

# ---------- Reusable proxy blocks via named upstreams ----------
# proto WS ports:  vmess 10001 · vless 10002 · trojan 10003
# proto xHTTP:     vmess 10011 · vless 10012 · trojan 10013
# proto HTTPUpgrade: vmess 10021 · vless 10022 · trojan 10023

# ---------------- Plain HTTP (Cloudflare orange-cloud plain ports) ---------
server {
__PLAIN_LISTENS__
    server_name __SERVER_NAMES__;
    client_max_body_size 1m;

    location = / {
        if ($is_ws) { rewrite ^ /__ws last; }
        return 404;
    }
    location /__ws {
        internal;
        limit_req  zone=vpn_ws burst=60 nodelay;
        proxy_pass         http://127.0.0.1:10000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_read_timeout 7d; proxy_send_timeout 7d;
    }

    # xray WebSocket
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

    # xray xHTTP (streaming HTTP/2 style — no Upgrade header)
    location /vmess-xh  { proxy_pass http://127.0.0.1:10011; proxy_http_version 1.1;
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off; proxy_request_buffering off; proxy_read_timeout 7d; }
    location /vless-xh  { proxy_pass http://127.0.0.1:10012; proxy_http_version 1.1;
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off; proxy_request_buffering off; proxy_read_timeout 7d; }
    location /trojan-xh { proxy_pass http://127.0.0.1:10013; proxy_http_version 1.1;
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off; proxy_request_buffering off; proxy_read_timeout 7d; }

    # xray HTTPUpgrade (raw TCP after Upgrade — like WS but no framing)
    location /vmess-hu  { limit_req zone=vpn_ws burst=60 nodelay;
        proxy_pass http://127.0.0.1:10021; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }
    location /vless-hu  { limit_req zone=vpn_ws burst=60 nodelay;
        proxy_pass http://127.0.0.1:10022; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }
    location /trojan-hu { limit_req zone=vpn_ws burst=60 nodelay;
        proxy_pass http://127.0.0.1:10023; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }

    location / { return 404; }
    access_log /var/log/nginx/autoscript-access.log;
    error_log  /var/log/nginx/autoscript-error.log;
}

# ---------------- TLS (Cloudflare-supported TLS ports) ---------------------
server {
__TLS_LISTENS__
    server_name __SERVER_NAMES__;

    ssl_certificate     __CERT__/fullchain.pem;
    ssl_certificate_key __CERT__/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    client_max_body_size 1m;

    location = / {
        if ($is_ws) { rewrite ^ /__ws last; }
        return 404;
    }
    location /__ws {
        internal;
        limit_req  zone=vpn_ws burst=60 nodelay;
        proxy_pass         http://127.0.0.1:10000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_read_timeout 7d; proxy_send_timeout 7d;
    }

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

    location /vmess-xh  { proxy_pass http://127.0.0.1:10011; proxy_http_version 1.1;
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off; proxy_request_buffering off; proxy_read_timeout 7d; }
    location /vless-xh  { proxy_pass http://127.0.0.1:10012; proxy_http_version 1.1;
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off; proxy_request_buffering off; proxy_read_timeout 7d; }
    location /trojan-xh { proxy_pass http://127.0.0.1:10013; proxy_http_version 1.1;
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off; proxy_request_buffering off; proxy_read_timeout 7d; }

    location /vmess-hu  { limit_req zone=vpn_ws burst=60 nodelay;
        proxy_pass http://127.0.0.1:10021; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }
    location /vless-hu  { limit_req zone=vpn_ws burst=60 nodelay;
        proxy_pass http://127.0.0.1:10022; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }
    location /trojan-hu { limit_req zone=vpn_ws burst=60 nodelay;
        proxy_pass http://127.0.0.1:10023; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }

    location / { return 404; }
    access_log /var/log/nginx/autoscript-access.log;
    error_log  /var/log/nginx/autoscript-error.log;
}
