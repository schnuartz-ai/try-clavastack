#!/usr/bin/env bash
# Install only the Electrum adapter into the existing A/B API service.
set -euo pipefail
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root on try-clavastack-vps" >&2
  exit 1
fi
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET=/opt/try-clavastack/pool
test -f "$TARGET/ab_api.py"
test -f "$TARGET/ab_builds.py"
test "$(systemctl show --property=LoadState --value try-ab-builder.service)" = loaded
if [[ $(realpath "$ROOT/pool/ab_api.py") == "$TARGET/ab_api.py" ]]; then
  echo "Run this installer from a separate staging directory so rollback preserves the installed API." >&2
  exit 1
fi
for name in ab_api.py electrum_relay.py; do test -f "$ROOT/pool/$name"; done
STAGE=$(mktemp -d)
trap 'rm -rf -- "$STAGE"' EXIT
PYTHONPYCACHEPREFIX="$STAGE/pycache" python3 -m py_compile "$ROOT/pool/ab_api.py" "$ROOT/pool/electrum_relay.py"
cp -a "$TARGET/ab_api.py" "$STAGE/ab_api.py"
if [[ -f "$TARGET/electrum_relay.py" ]]; then cp -a "$TARGET/electrum_relay.py" "$STAGE/electrum_relay.py"; fi
rollback() {
  status=$?
  if [[ $status != 0 ]]; then
    cp -a "$STAGE/ab_api.py" "$TARGET/ab_api.py"
    if [[ -f "$STAGE/electrum_relay.py" ]]; then
      cp -a "$STAGE/electrum_relay.py" "$TARGET/electrum_relay.py"
    else
      rm -f -- "$TARGET/electrum_relay.py"
    fi
    systemctl restart try-ab-builder.service
    echo "Electrum installation failed; previous API restored." >&2
  fi
  rm -rf -- "$STAGE"
}
trap rollback EXIT
install -o root -g root -m 0644 "$ROOT/pool/ab_api.py" "$ROOT/pool/electrum_relay.py" "$TARGET/"
systemctl restart try-ab-builder.service
for attempt in {1..10}; do
  if curl --fail --silent http://127.0.0.1:9002/api/ab/health > "$STAGE/health.json"; then break; fi
  sleep 1
done
python3 - "$STAGE/health.json" <<'PY'
import json, sys
with open(sys.argv[1]) as file:
    assert json.load(file)["electrum"]["tls"] is True
PY
curl --fail --silent --show-error --max-time 50 \
  -H 'Content-Type: application/json' \
  --data '{"host":"electrum.blockstream.info","port":50002,"ssl":true,"method":"server.version","params":["ClavaStack deployment check","1.4"]}' \
  http://127.0.0.1:9002/api/ab/electrum > "$STAGE/version.json"
python3 - "$STAGE/version.json" <<'PY'
import json, sys
with open(sys.argv[1]) as file:
    response = json.load(file)
assert response.get("result") and not response.get("error"), response
print("Electrum TLS relay verified:", response["result"])
PY
echo "Installed. Existing Caddy /api/ab/* routing serves the relay; no new public port is needed."
