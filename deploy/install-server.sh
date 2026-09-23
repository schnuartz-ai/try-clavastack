#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this installer as root" >&2
  exit 1
fi

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEPLOY_ROOT="/var/www/try-clavastack-deploy"
DEPLOY_USER="clavastack-deploy"
AB_BUILD_USER="clavastack-ab"
LIBEXEC_DIR="/usr/local/libexec/try-clavastack"

for required in \
  "$ROOT/deploy/deploy-site-release.sh" \
  "$ROOT/vps-config/Caddyfile" \
  "$ROOT/vps-config/Caddyfile.root" \
  "$ROOT/vps-config/systemd/try-browser-auto-deploy.service" \
  "$ROOT/vps-config/systemd/try-ab-builder.service" \
  "$ROOT/vps-config/systemd/try-browser-auto-deploy.timer"; do
  test -f "$required"
done

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/try-clavastack \
    --shell /usr/sbin/nologin "$DEPLOY_USER"
fi
if ! id "$AB_BUILD_USER" >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/try-clavastack/ab-work \
    --shell /usr/sbin/nologin "$AB_BUILD_USER"
fi
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 \
  "$DEPLOY_ROOT" "$DEPLOY_ROOT/releases" /var/lib/try-clavastack
install -d -o "$AB_BUILD_USER" -g "$AB_BUILD_USER" -m 0750 \
  /var/lib/try-clavastack/ab-builds /var/lib/try-clavastack/ab-work \
  /var/lib/try-clavastack/ab-usage
chown "$DEPLOY_USER:$DEPLOY_USER" \
  "$DEPLOY_ROOT" "$DEPLOY_ROOT/releases" /var/lib/try-clavastack
install -d -o root -g root -m 0755 "$LIBEXEC_DIR"
install -d -o root -g root -m 0755 /etc/caddy/sites-enabled
install -o root -g root -m 0755 \
  "$ROOT/deploy/deploy-site-release.sh" \
  "$LIBEXEC_DIR/deploy-site-release.sh"

caddy validate --adapter caddyfile --config "$ROOT/vps-config/Caddyfile"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
install -o root -g root -m 0644 /etc/caddy/Caddyfile \
  "/etc/caddy/Caddyfile.pre-gitops-$stamp"
install -o root -g root -m 0644 "$ROOT/vps-config/Caddyfile.root" /etc/caddy/Caddyfile
install -o root -g root -m 0644 "$ROOT/vps-config/Caddyfile" \
  /etc/caddy/sites-enabled/try.clavastack.caddy
install -o root -g root -m 0644 \
  "$ROOT/vps-config/systemd/try-browser-auto-deploy.service" \
  /etc/systemd/system/try-browser-auto-deploy.service
install -o root -g root -m 0644 \
  "$ROOT/vps-config/systemd/try-ab-builder.service" \
  /etc/systemd/system/try-ab-builder.service
install -o root -g root -m 0644 \
  "$ROOT/vps-config/systemd/try-browser-auto-deploy.timer" \
  /etc/systemd/system/try-browser-auto-deploy.timer

systemctl daemon-reload
systemctl enable --now try-ab-builder.service
curl --fail --silent --show-error \
  --connect-timeout 5 --max-time 10 \
  http://127.0.0.1:9002/api/ab/health >/dev/null
systemctl enable try-browser-auto-deploy.timer
systemctl restart try-browser-auto-deploy.timer
if [[ ! -L "$DEPLOY_ROOT/current" ]]; then
  systemctl start try-browser-auto-deploy.service
fi
caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
systemctl reload caddy

curl --fail --silent --show-error \
  --resolve try.clavastack.com:443:127.0.0.1 \
  --connect-timeout 5 --max-time 20 \
  https://try.clavastack.com/ >/dev/null
curl --fail --silent --show-error \
  --resolve try.clavastack.com:443:127.0.0.1 \
  --connect-timeout 5 --max-time 20 \
  https://try.clavastack.com/api/ab/health >/dev/null

echo "Static GitHub release deployment installed."
