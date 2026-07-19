#!/usr/bin/env python3
"""Idempotently add/remove Autoscript users across every Xray transport inbound
for a given protocol. Each protocol has three inbounds:
  <proto>-ws  (WebSocket)     -> path /<proto>
  <proto>-xh  (xHTTP)         -> path /<proto>-xh
  <proto>-hu  (HTTPUpgrade)   -> path /<proto>-hu
Users are the same across all three; only the transport differs.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

CFG = Path(os.environ.get("XRAY_CFG", "/usr/local/etc/xray/config.json"))
PROTOCOLS = ("vmess", "vless", "trojan")
TRANSPORTS = ("ws", "xh", "hu")


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def load() -> dict:
    if not CFG.exists():
        die(f"xray config missing: {CFG}")
    try:
        return json.loads(CFG.read_text())
    except Exception as exc:
        die(f"invalid xray config: {exc}")


def inbound(cfg: dict, tag: str) -> dict | None:
    for item in cfg.get("inbounds", []):
        if item.get("tag") == tag:
            item.setdefault("settings", {}).setdefault("clients", [])
            return item
    return None


def client(proto: str, username: str, uuid: str) -> dict:
    if proto == "vmess":
        return {"id": uuid, "email": username, "alterId": 0, "level": 0}
    if proto == "vless":
        return {"id": uuid, "email": username, "level": 0}
    if proto == "trojan":
        return {"password": uuid, "email": username, "level": 0}
    die(f"unsupported protocol: {proto}")


def save(cfg: dict) -> None:
    tmp = CFG.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cfg, indent=2) + "\n")
    tmp.replace(CFG)


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"add", "remove"} or sys.argv[2] not in PROTOCOLS:
        die("usage: xray_client.py add|remove vmess|vless|trojan")
    action, proto = sys.argv[1:3]
    username = os.environ.get("USERNAME", "").strip()
    uuid = os.environ.get("UUID", "").strip()
    if not username:
        die("USERNAME is required")
    cfg = load()
    touched = 0
    for tr in TRANSPORTS:
        ib = inbound(cfg, f"{proto}-{tr}")
        if not ib:
            continue
        clients = ib["settings"]["clients"]
        clients[:] = [c for c in clients if c.get("email") != username]
        if action == "add":
            if not uuid:
                die("UUID is required")
            clients.append(client(proto, username, uuid))
        touched += 1
    if touched == 0:
        die(f"no xray inbounds found for {proto}")
    save(cfg)
    print(f"{action} {proto} user {username} across {touched} transport(s)")


if __name__ == "__main__":
    main()
