# One-line map:  Nginx (443) --> Web UI static + agent /api + SSH-WS on /
#
# The `/` location proxies WebSocket upgrades to the local SSH-WS bridge on
# 127.0.0.1:2095 (HTTP/1.1 pinned).  Non-upgrade requests fall through to the
# static web UI so that visiting https://panel/ in a browser shows the panel.
#
# NOTE: same fullchain is used by xray for VMess/VLESS/Trojan TLS.

map $http_upgrade $is_ws { default 0; websocket 1; }

server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name __DOMAIN__;

    ssl_certificate     __CERT__/fullchain.pem;
    ssl_certificate_key __CERT__/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    root __ROOT__/dist;
    index index.html;

    # --- Panel API -----------------------------------------------------------
    location /api/ {
        proxy_pass         http://127.0.0.1:8088;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # --- SSH over WebSocket on "/" (HTTP/1.1 upgrade) ------------------------
    # If the request is a WebSocket upgrade we hand it to the SSH-WS bridge.
    # Otherwise we serve the SPA.  This removes the old random-path scheme.
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

    # --- xray WS paths (each protocol its own path) --------------------------
    location /vmess  { proxy_pass http://127.0.0.1:10001; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_read_timeout 7d; }
    location /vless  { proxy_pass http://127.0.0.1:10002; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_read_timeout 7d; }
    location /trojan { proxy_pass http://127.0.0.1:10003; proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
        proxy_set_header Host $host; proxy_read_timeout 7d; }

    # --- SPA fallback --------------------------------------------------------
    location / {
        try_files $uri $uri/ /index.html;
    }

    access_log /var/log/nginx/autoscript-access.log;
    error_log  /var/log/nginx/autoscript-error.log;
}
