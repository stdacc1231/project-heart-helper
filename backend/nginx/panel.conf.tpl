# Nginx template — Autoscript panel.  install.sh substitutes __DOMAIN__, __PORT__,
# __ROOT__, __CERT__.  The `/` location proxies WebSocket upgrades to the local
# SSH-WS bridge on 127.0.0.1:2095 (HTTP/1.1 pinned); non-upgrade requests fall
# through to the SPA so the panel loads.
#
# CDN-safe (Cloudflare / any reverse proxy):
#  - real client IP is restored from CF-Connecting-IP for the Cloudflare edge
#  - HTTP/1.1 is pinned on every upgrade block (Cloudflare and most CDNs
#    only tunnel WebSocket on HTTP/1.1)
#  - path "/" is used for SSH-WS so it works through CF WS orange-cloud
#  - a stable /sub/<token> endpoint serves per-user subscription bundles

map $http_upgrade $is_ws { default 0; websocket 1; }

# Cloudflare edge ranges — set real client IP through CDN
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

server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;
    return 301 https://$host$request_uri;
}

server {
    listen __PORT__ ssl http2;
    listen [::]:__PORT__ ssl http2;
    server_name __DOMAIN__;

    ssl_certificate     __CERT__/fullchain.pem;
    ssl_certificate_key __CERT__/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    root __ROOT__/dist;
    index index.html;

    client_max_body_size 20m;

    # Common upgrade headers snippet for every WS location below
    # (Cloudflare needs proxy_http_version 1.1 to tunnel WS)

    location /api/ {
        proxy_pass         http://127.0.0.1:8088;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # Per-user subscription bundles (v2rayNG / Clash / sing-box / Shadowrocket)
    location /sub/ {
        proxy_pass         http://127.0.0.1:8088;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
    }

    # SSH over WebSocket on "/" (HTTP/1.1). Cloudflare tunnels this on plans that
    # allow WebSockets (Free tier does — port 443 only). No random path.
    location = / {
        if ($is_ws) { rewrite ^ /__ws last; }
        try_files /index.html =404;
    }
    location /__ws {
        internal;
        proxy_pass         http://127.0.0.1:2095;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade       $http_upgrade;
        proxy_set_header   Connection    "upgrade";
        proxy_set_header   Host          $host;
        proxy_read_timeout 7d;
        proxy_send_timeout 7d;
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

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    access_log /var/log/nginx/autoscript-access.log;
    error_log  /var/log/nginx/autoscript-error.log;
}
