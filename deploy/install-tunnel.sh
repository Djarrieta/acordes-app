#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Ejecutar como root (sudo)." >&2
  exit 1
fi

TOKEN_FILE="${1:-}"
if [[ -z "$TOKEN_FILE" || ! -f "$TOKEN_FILE" ]]; then
  echo "Uso: $0 /ruta/al/archivo/con/el/token" >&2
  echo "El archivo debe contener una línea TUNNEL_TOKEN=..." >&2
  exit 1
fi

install -d -m 755 /etc/cloudflared
install -m 600 "$TOKEN_FILE" /etc/cloudflared/acordes.env
install -m 644 deploy/cloudflared-acordes.service /etc/systemd/system/cloudflared-acordes.service
systemctl daemon-reload
systemctl enable --now cloudflared-acordes.service
systemctl status cloudflared-acordes.service --no-pager
