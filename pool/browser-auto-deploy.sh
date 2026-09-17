#!/bin/bash
set -euo pipefail

REPOSITORY="schnuartz-ai/try-clavastack"
WORKFLOW="browser.yml"
ARTIFACT="browser-builds"
WEBROOT="/var/www/try-clavastack"
STATE_DIR="/var/lib/try-clavastack"
STATE_FILE="$STATE_DIR/browser-last-deployed-run"

exec 9>/run/lock/try-browser-auto-deploy.lock
flock -n 9 || exit 0

RUN_ID=$(gh run list --repo "$REPOSITORY" --workflow "$WORKFLOW" --limit 20 \
  --json databaseId,headBranch,status,conclusion \
  --jq '[.[] | select(.headBranch == "main" and .status == "completed" and .conclusion == "success")][0].databaseId // empty')
test -n "$RUN_ID" || exit 0

if [[ -f "$STATE_FILE" && "$(cat "$STATE_FILE")" == "$RUN_ID" ]]; then
  exit 0
fi

WORK_DIR=$(mktemp -d /tmp/try-browser-auto-deploy.XXXXXX)
trap 'rm -rf -- "$WORK_DIR"' EXIT
gh run download "$RUN_ID" --repo "$REPOSITORY" --name "$ARTIFACT" --dir "$WORK_DIR"

python3 - "$WORK_DIR" <<'PY'
import hashlib, json, pathlib, re, sys

root = pathlib.Path(sys.argv[1]).resolve()
pointers = {
    "browser/current.json": {"cryptoadvance/specter-diy"},
    "browser/variants/specter-playground.json": {"k9ert/specter-playground"},
    "browser/variants/specter-playground-fast.json": {"schnuartz-ai/specter-playground"},
    "browser/variants/specter-playground-schnuartz.json": {"schnuartz/specter-playground"},
    "browser/variants/specter-playground-schnuartz-alternative.json": {
        "schnuartz-ai/specter-playground-schnuartz"
    },
}
path_pattern = re.compile(r"/builds/[A-Za-z0-9-]+/[A-Za-z0-9-]+/[0-9a-f]{40}/")
for pointer_name, repositories in pointers.items():
    pointer_path = root / pointer_name
    if not pointer_path.is_file():
        raise SystemExit(f"Missing pointer: {pointer_name}")
    pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
    build_path = pointer.get("build", "")
    if not path_pattern.fullmatch(build_path):
        raise SystemExit(f"Refusing unexpected build path: {build_path}")
    build = root / build_path.lstrip("/")
    manifest = json.loads((build / "build-info.json").read_text(encoding="utf-8"))
    if manifest.get("repository", "").lower() not in {item.lower() for item in repositories}:
        raise SystemExit(f"Wrong repository in {pointer_name}")
    commit = manifest.get("commit", "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or f"/{commit}/" not in build_path:
        raise SystemExit(f"Invalid source commit in {pointer_name}")
    if pointer.get("version") != manifest.get("artifact_set_sha256", "")[:16]:
        raise SystemExit(f"Pointer hash mismatch in {pointer_name}")
    for name, expected in manifest.get("artifacts", {}).items():
        path = build / name
        if path.stat().st_size != expected["bytes"] or hashlib.sha256(path.read_bytes()).hexdigest() != expected["sha256"]:
            raise SystemExit(f"Artifact hash mismatch: {pointer_name} {name}")
PY

# Publish immutable build directories before switching any revalidated pointer.
while IFS= read -r -d '' source; do
    relative="${source#"$WORK_DIR/"}"
    install -D -m 0644 "$source" "$WEBROOT/$relative"
done < <(find "$WORK_DIR/builds" -type f -print0)
for pointer in browser/current.json \
    browser/variants/specter-playground.json \
    browser/variants/specter-playground-fast.json \
    browser/variants/specter-playground-schnuartz.json \
    browser/variants/specter-playground-schnuartz-alternative.json; do
  install -D -m 0644 "$WORK_DIR/$pointer" "$WEBROOT/$pointer"
done
install -d -m 0755 "$STATE_DIR"
printf '%s\n' "$RUN_ID" > "$STATE_FILE"
