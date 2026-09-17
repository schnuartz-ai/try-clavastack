#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this installer as root" >&2
  exit 1
fi

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LEGACY_WEBROOT="/var/www/try-clavastack"
DEPLOY_ROOT="/var/www/try-clavastack-deploy"
DEPLOY_USER="clavastack-deploy"
LIBEXEC_DIR="/usr/local/libexec/try-clavastack"

for required in \
  "$ROOT/deploy/deploy-site-release.sh" \
  "$ROOT/vps-config/Caddyfile" \
  "$ROOT/vps-config/systemd/try-browser-auto-deploy.service" \
  "$ROOT/vps-config/systemd/try-browser-auto-deploy.timer"; do
  test -f "$required"
done

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/try-clavastack \
    --shell /usr/sbin/nologin "$DEPLOY_USER"
fi

install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 \
  "$DEPLOY_ROOT" "$DEPLOY_ROOT/releases"
install -d -o root -g root -m 0755 "$LIBEXEC_DIR"
install -o root -g root -m 0755 \
  "$ROOT/deploy/deploy-site-release.sh" \
  "$LIBEXEC_DIR/deploy-site-release.sh"

# Establish an independently stored rollback target before Caddy is changed.
# Generated work directories and historical previews are deliberately omitted.
if [[ ! -L "$DEPLOY_ROOT/current" ]]; then
  bootstrap="$DEPLOY_ROOT/releases/bootstrap"
  test ! -e "$bootstrap"
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 "$bootstrap"
  rsync -a \
    --exclude='/.browser-work/' \
    --exclude='/pr/' \
    --exclude='/.deploy-backups/' \
    --exclude='/.backup*/' \
    --exclude='*.bak*' \
    --exclude='*.backup*' \
    --exclude='*.before-*' \
    "$LEGACY_WEBROOT/" "$bootstrap/"
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$bootstrap"
  ln -s "$bootstrap" "$DEPLOY_ROOT/current"
fi

caddy validate --adapter caddyfile --config "$ROOT/vps-config/Caddyfile"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
install -o root -g root -m 0644 /etc/caddy/Caddyfile \
  "/etc/caddy/Caddyfile.pre-gitops-$stamp"
install -o root -g root -m 0644 "$ROOT/vps-config/Caddyfile" /etc/caddy/Caddyfile
install -o root -g root -m 0644 \
  "$ROOT/vps-config/systemd/try-browser-auto-deploy.service" \
  /etc/systemd/system/try-browser-auto-deploy.service
install -o root -g root -m 0644 \
  "$ROOT/vps-config/systemd/try-browser-auto-deploy.timer" \
  /etc/systemd/system/try-browser-auto-deploy.timer

systemctl daemon-reload
systemctl disable --now try-auto-update.timer 2>/dev/null || true
systemctl enable try-browser-auto-deploy.timer
systemctl restart try-browser-auto-deploy.timer
systemctl reload caddy

curl --fail --silent --show-error \
  --resolve try.clavastack.com:443:127.0.0.1 \
  --connect-timeout 5 --max-time 20 \
  https://try.clavastack.com/ >/dev/null

echo "GitHub release deployment installed; bootstrap is live."
