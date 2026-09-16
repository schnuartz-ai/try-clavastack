#!/bin/bash
set -euo pipefail

REPOSITORY="schnuartz-ai/try-clavastack"
WORKFLOW="official-browser-firmware.yml"
WEBROOT="/var/www/try-clavastack"
STATE_DIR="/var/lib/try-clavastack"
STATE_FILE="$STATE_DIR/browser-last-deployed-run"

exec 9>/run/lock/try-browser-auto-deploy.lock
flock -n 9 || exit 0

RUN_ID=$(gh run list --repo "$REPOSITORY" --workflow "$WORKFLOW" --branch main \
  --status success --limit 1 --json databaseId --jq '.[0].databaseId // empty')
test -n "$RUN_ID" || exit 0

if [[ -f "$STATE_FILE" && "$(cat "$STATE_FILE")" == "$RUN_ID" ]]; then
  exit 0
fi

WORK_DIR=$(mktemp -d /tmp/try-browser-auto-deploy.XXXXXX)
trap 'rm -rf -- "$WORK_DIR"' EXIT
gh run download "$RUN_ID" --repo "$REPOSITORY" --name official-browser-builds --dir "$WORK_DIR"

POINTER="$WORK_DIR/browser/current.json"
test -f "$POINTER"
BUILD_PATH=$(python3 - "$POINTER" <<'PY'
import json, re, sys
pointer = json.load(open(sys.argv[1], encoding="utf-8"))
path = pointer.get("build", "")
if not re.fullmatch(r"/builds/cryptoadvance/specter-diy/[0-9a-f]{40}/", path):
    raise SystemExit("Refusing unexpected browser build path")
print(path)
PY
)
SOURCE_BUILD="$WORK_DIR$BUILD_PATH"

python3 - "$SOURCE_BUILD" <<'PY'
import hashlib, json, pathlib, re, sys
build = pathlib.Path(sys.argv[1]).resolve()
manifest = json.loads((build / "build-info.json").read_text(encoding="utf-8"))
if manifest.get("repository") != "cryptoadvance/specter-diy":
    raise SystemExit("Refusing non-official firmware repository")
if not re.fullmatch(r"[0-9a-f]{40}", manifest.get("commit", "")):
    raise SystemExit("Invalid firmware commit")
if not re.fullmatch(r"\d+\.\d+\.\d+(?:-rc\d+)?", manifest.get("firmware_version", "")):
    raise SystemExit("Invalid firmware version")
for name in ("micropython.js", "micropython.wasm", "micropython.data"):
    path = build / name
    expected = manifest["artifacts"][name]
    if path.stat().st_size != expected["bytes"]:
        raise SystemExit(f"Size mismatch: {name}")
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected["sha256"]:
        raise SystemExit(f"Hash mismatch: {name}")
PY

TARGET_BUILD="$WEBROOT$BUILD_PATH"
install -d -m 0755 "$TARGET_BUILD"
for name in micropython.js micropython.wasm micropython.data build-info.json; do
  install -m 0644 "$SOURCE_BUILD/$name" "$TARGET_BUILD/$name"
done
# Publish the immutable artifact directory before switching the revalidated
# pointer. Existing sessions continue using their versioned URLs.
install -m 0644 "$POINTER" "$WEBROOT/browser/current.json"
install -d -m 0755 "$STATE_DIR"
printf '%s\n' "$RUN_ID" > "$STATE_FILE"
