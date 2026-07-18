# Autoscript panel — Nginx template. Rendered by apply_settings.sh.
# Placeholders (documented without literal tokens so awk/sed do not touch them):
#   SERVER_NAMES  -> space-separated panel domain + per-protocol hosts
#   TLS_LISTENS   -> listen directives for every TLS port
#   PLAIN_LISTENS -> listen directives for every plain port
#   ROOT / CERT   -> install and cert paths
#
# Key rules:
#   - Every listener serves the SAME vhost (panel + SSH-WS + xray + /sub/).
#   - SSH-over-WebSocket on path "/", HTTP/1.1 pinned — Cloudflare-compatible.
#   - Cloudflare real IP restored from CF-Connecting-IP.

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

# ------------------------------ Plain-HTTP / plain-WS (Cloudflare orange-cloud) ---
server {
__PLAIN_LISTENS__
    server_name __SERVER_NAMES__;
    root __ROOT__/dist;
    index index.html;
    client_max_body_size 20m;

    # SSH-WS on "/" over plain WebSocket
    location = / {
        if ($is_ws) { rewrite ^ /__ws last; }
        return 301 https://$host$request_uri;
    }
    location /__ws {
        internal;
        proxy_pass         http://127.0.0.1:2095;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_read_timeout 7d; proxy_send_timeout 7d;
    }
    location /api/ { return 301 https://$host$request_uri; }
    location /    { return 301 https://$host$request_uri; }
}

# ------------------------------ TLS (multiple CF ports) --------------------------
server {
__TLS_LISTENS__
    server_name __SERVER_NAMES__;

    ssl_certificate     __CERT__/fullchain.pem;
    ssl_certificate_key __CERT__/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    root __ROOT__/dist;
    index index.html;
    client_max_body_size 20m;

    # Panel API
    location /api/ {
        proxy_pass         http://127.0.0.1:8088;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # Per-user subscription bundles + public user detail page
    location /sub/ { proxy_pass http://127.0.0.1:8088; proxy_http_version 1.1;
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; }
    location /u/   { proxy_pass http://127.0.0.1:8088; proxy_http_version 1.1;
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; }

    # SSH over WebSocket on "/" (HTTP/1.1, no random path)
    location = / {
        if ($is_ws) { rewrite ^ /__ws last; }
        try_files /index.html =404;
    }
    location /__ws {
        internal;
        proxy_pass         http://127.0.0.1:2095;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_read_timeout 7d; proxy_send_timeout 7d;
    }

    # xray WS paths
    location /vmess  { proxy_pass http://127.0.0.1:10001; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }
    location /vless  { proxy_pass http://127.0.0.1:10002; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }
    location /trojan { proxy_pass http://127.0.0.1:10003; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 7d; }

    location / { try_files $uri $uri/ /index.html; }

    access_log /var/log/nginx/autoscript-access.log;
    error_log  /var/log/nginx/autoscript-error.log;
}
