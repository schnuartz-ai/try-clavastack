#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUTPUT_DIR=${1:-"$ROOT/dist"}
RUN_ID=${GITHUB_RUN_ID:-local}
if [[ -n ${GITHUB_SHA:-} ]]; then
  SOURCE_SHA=$GITHUB_SHA
else
  SOURCE_SHA=$(git -C "$ROOT" rev-parse HEAD)
fi

if [[ ! "$RUN_ID" =~ ^[0-9]+$ ]] && [[ "$RUN_ID" != "local" ]]; then
  echo "Invalid deployment run id: $RUN_ID" >&2
  exit 1
fi
if [[ ! "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid source commit: $SOURCE_SHA" >&2
  exit 1
fi

WORK_DIR=$(mktemp -d)
trap 'rm -rf -- "$WORK_DIR"' EXIT
SITE_DIR="$WORK_DIR/site"
mkdir -p "$SITE_DIR" "$OUTPUT_DIR"

paths=(
  index.html
  apple-touch-icon.png
  favicon.ico
  icon-192.png
  icon-512.png
  robots.txt
  sitemap.xml
  site.webmanifest
  llms.txt
  assets
  builds
  ab
  simulators
)

for path in "${paths[@]}"; do
  if [[ ! -e "$ROOT/$path" ]]; then
    echo "Missing production path: $path" >&2
    exit 1
  fi
  cp -aL "$ROOT/$path" "$SITE_DIR/$path"
done

mkdir -p "$SITE_DIR/browser/variants"
cp "$ROOT/browser/site.js" "$ROOT/browser/runtime-worker.js" \
  "$ROOT/browser/current.json" "$ROOT/browser/demo-data.js" \
  "$SITE_DIR/browser/"
cp "$ROOT/browser/variants/"*.json "$SITE_DIR/browser/variants/"

if [[ $(find "$SITE_DIR/builds" -type f -name 'micropython.wasm' | wc -l) -lt 4 ]]; then
  echo "Expected all four tested firmware builds in the production package" >&2
  exit 1
fi

# Development-only files must never become reachable from the public webroot.
find "$SITE_DIR" -type f \( \
  -name '*.bak' -o -name '*.backup' -o -name '*.before-*' -o \
  -name 'test-*.mjs' -o -name 'diagnose-*.mjs' \
\) -delete
rm -rf -- "$SITE_DIR/simulators/legacy"

python3 - "$SITE_DIR/deployment.json" "$RUN_ID" "$SOURCE_SHA" <<'PY'
import datetime
import json
import pathlib
import sys

path, run_id, source_sha = sys.argv[1:]
payload = {
    "repository": "schnuartz-ai/try-clavastack",
    "run_id": run_id,
    "source_sha": source_sha,
    "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
pathlib.Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY

(
  cd "$SITE_DIR"
  find . -type f ! -name SHA256SUMS -print0 \
    | sort -z \
    | xargs -0 sha256sum > SHA256SUMS
  sha256sum -c SHA256SUMS
)

ARCHIVE="$OUTPUT_DIR/site-release-$RUN_ID.tar.gz"
tar -C "$SITE_DIR" -czf "$ARCHIVE" .
(
  cd "$OUTPUT_DIR"
  sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256"
)

printf '%s\n' "$ARCHIVE"
