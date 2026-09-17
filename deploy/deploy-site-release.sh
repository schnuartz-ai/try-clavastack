#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="schnuartz-ai/try-clavastack"
RELEASE_TAG="production"
WEBROOT="/var/www/try-clavastack-deploy"
RELEASE_ROOT="$WEBROOT/releases"
CURRENT_LINK="$WEBROOT/current"
STATE_DIR="/var/lib/try-clavastack"
STATE_FILE="$STATE_DIR/site-last-deployed-run"
LOCK_FILE="/run/try-clavastack/site-deploy.lock"

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

WORK_DIR=$(mktemp -d)
trap 'rm -rf -- "$WORK_DIR"' EXIT

RELEASE_JSON="$WORK_DIR/release.json"
curl --fail --silent --show-error --location \
  --retry 3 --connect-timeout 10 --max-time 60 \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  -H 'User-Agent: try-clavastack-deployer' \
  "https://api.github.com/repos/$REPOSITORY/releases/tags/$RELEASE_TAG" \
  --output "$RELEASE_JSON"

mapfile -t RELEASE_INFO < <(python3 - "$RELEASE_JSON" <<'PY'
import json
import re
import sys

release = json.load(open(sys.argv[1], encoding="utf-8"))
assets = {asset["name"]: asset["browser_download_url"] for asset in release.get("assets", [])}
runs = []
for name in assets:
    match = re.fullmatch(r"site-release-([0-9]+)\.tar\.gz", name)
    if match and f"{name}.sha256" in assets:
        runs.append(int(match.group(1)))
if not runs:
    raise SystemExit("No complete site release found")
run_id = max(runs)
archive = f"site-release-{run_id}.tar.gz"
print(run_id)
print(assets[archive])
print(assets[f"{archive}.sha256"])
PY
)

RUN_ID=${RELEASE_INFO[0]}
ARCHIVE_URL=${RELEASE_INFO[1]}
CHECKSUM_URL=${RELEASE_INFO[2]}

if [[ -f "$STATE_FILE" ]] && [[ "$(cat "$STATE_FILE")" == "$RUN_ID" ]]; then
  exit 0
fi

ARCHIVE_NAME="site-release-$RUN_ID.tar.gz"
curl --fail --silent --show-error --location --retry 3 \
  --connect-timeout 10 --max-time 300 "$ARCHIVE_URL" \
  --output "$WORK_DIR/$ARCHIVE_NAME"
curl --fail --silent --show-error --location --retry 3 \
  --connect-timeout 10 --max-time 60 "$CHECKSUM_URL" \
  --output "$WORK_DIR/$ARCHIVE_NAME.sha256"
(
  cd "$WORK_DIR"
  sha256sum -c "$ARCHIVE_NAME.sha256"
)

STAGING_DIR="$RELEASE_ROOT/.staging-$RUN_ID"
FINAL_DIR="$RELEASE_ROOT/$RUN_ID"
rm -rf -- "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
tar -C "$STAGING_DIR" -xzf "$WORK_DIR/$ARCHIVE_NAME"
(
  cd "$STAGING_DIR"
  sha256sum -c SHA256SUMS
)

python3 - "$STAGING_DIR/deployment.json" "$RUN_ID" <<'PY'
import json
import re
import sys

deployment = json.load(open(sys.argv[1], encoding="utf-8"))
if str(deployment.get("run_id")) != sys.argv[2]:
    raise SystemExit("Deployment run id does not match release asset")
if deployment.get("repository") != "schnuartz-ai/try-clavastack":
    raise SystemExit("Unexpected deployment repository")
if not re.fullmatch(r"[0-9a-f]{40}", deployment.get("source_sha", "")):
    raise SystemExit("Invalid deployment source commit")
PY

for required in \
  index.html \
  browser/site.js \
  browser/runtime-worker.js \
  browser/current.json \
  browser/variants/specter-playground.json \
  browser/variants/specter-playground-schnuartz.json \
  browser/variants/specter-playground-schnuartz-alternative.json; do
  test -f "$STAGING_DIR/$required"
done

if [[ -e "$FINAL_DIR" ]]; then
  rm -rf -- "$STAGING_DIR"
else
  mv "$STAGING_DIR" "$FINAL_DIR"
fi
chmod -R a=rX,u+w "$FINAL_DIR"

PREVIOUS_TARGET=$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)
ln -s "$FINAL_DIR" "$WEBROOT/.current-$RUN_ID"
mv -Tf "$WEBROOT/.current-$RUN_ID" "$CURRENT_LINK"

expected_sha=$(sha256sum "$FINAL_DIR/deployment.json" | cut -d' ' -f1)
deployed_sha=$(curl --fail --silent --show-error \
  --resolve try.clavastack.com:443:127.0.0.1 \
  --connect-timeout 5 --max-time 20 \
  https://try.clavastack.com/deployment.json | sha256sum | cut -d' ' -f1) || true
if [[ "$deployed_sha" != "$expected_sha" ]]; then
  if [[ -n "$PREVIOUS_TARGET" && -d "$PREVIOUS_TARGET" ]]; then
    ln -s "$PREVIOUS_TARGET" "$WEBROOT/.rollback-$RUN_ID"
    mv -Tf "$WEBROOT/.rollback-$RUN_ID" "$CURRENT_LINK"
  fi
  echo "Post-deployment health check failed; previous release restored" >&2
  exit 1
fi

printf '%s\n' "$RUN_ID" > "$STATE_FILE"

# Keep the seven newest immutable releases. Only numeric directories below the
# fixed release root are eligible, and the active target is never removed.
mapfile -t OLD_RELEASES < <(
  find "$RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended \
    -regex "$RELEASE_ROOT/[0-9]+" -printf '%f\n' | sort -nr | tail -n +8
)
for old_run in "${OLD_RELEASES[@]}"; do
  old_path="$RELEASE_ROOT/$old_run"
  if [[ "$(readlink -f "$CURRENT_LINK")" != "$old_path" ]]; then
    rm -rf -- "$old_path"
  fi
done
