#!/usr/bin/env python3
"""Idempotently add/remove Autoscript users in the local xray config."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

CFG = Path(os.environ.get("XRAY_CFG", "/usr/local/etc/xray/config.json"))
TAGS = {"vmess": "vmess-ws", "vless": "vless-ws", "trojan": "trojan-ws"}


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


def inbound(cfg: dict, proto: str) -> dict:
    tag = TAGS[proto]
    for item in cfg.get("inbounds", []):
        if item.get("tag") == tag:
            item.setdefault("settings", {}).setdefault("clients", [])
            return item
    die(f"xray inbound not found: {tag}")


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
    if len(sys.argv) != 3 or sys.argv[1] not in {"add", "remove"} or sys.argv[2] not in TAGS:
        die("usage: xray_client.py add|remove vmess|vless|trojan")
    action, proto = sys.argv[1:3]
    username = os.environ.get("USERNAME", "").strip()
    uuid = os.environ.get("UUID", "").strip()
    if not username:
        die("USERNAME is required")
    cfg = load()
    clients = inbound(cfg, proto)["settings"]["clients"]
    clients[:] = [c for c in clients if c.get("email") != username]
    if action == "add":
        if not uuid:
            die("UUID is required")
        clients.append(client(proto, username, uuid))
    save(cfg)
    print(f"{action} {proto} user {username}")


if __name__ == "__main__":
    main()