#!/bin/bash
# Auto-update script for try.clavastack.com simulator pools
# Runs via systemd timer every 15 minutes.
# Unlike the old version, this only restarts IDLE instances after an update.
# Occupied instances will pick up the new code when they are naturally reset
# after the user's session expires (idle-reset handles this).

LOG="/var/log/simulators/auto-update.log"
RESTART_SCRIPT="/opt/try-clavastack/pool/restart-simulator.sh"
ALLOCATOR_STATUS_URL="http://127.0.0.1:9001/api/status"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

# Get set of occupied instance IDs from the allocator API.
# Returns one instance ID per line, or empty if the API is unreachable.
get_occupied_instances() {
    local status
    status=$(curl -fsS --max-time 5 "$ALLOCATOR_STATUS_URL" 2>/dev/null) || return 0
    echo "$status" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for pool_name, pool_data in data.items():
        if not isinstance(pool_data, dict):
            continue
        for inst in pool_data.get('instances', []):
            if inst.get('status') == 'occupied':
                print(inst.get('id', ''))
except Exception:
    pass
" 2>/dev/null
}

update_repo() {
    local REPO_DIR="$1"
    local POOL_PREFIX="$2"
    local REPO_NAME="$3"

    cd "$REPO_DIR" || { log "ERROR: cannot cd to $REPO_DIR"; return 1; }

    git fetch origin 2>/dev/null
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse "origin/$(git symbolic-ref --short HEAD 2>/dev/null || echo main)")

    if [ "$LOCAL" = "$REMOTE" ]; then
        log "$REPO_NAME: up to date (${LOCAL:0:10})"
        return 0
    fi

    log "$REPO_NAME: update available (${LOCAL:0:10} -> ${REMOTE:0:10})"
    git reset --hard "$REMOTE" >> "$LOG" 2>&1

    # Build step (unchanged)
    if [ -f Makefile ] && grep -q "^unix:" Makefile; then
        log "$REPO_NAME: rebuilding micropython_unix..."
        if ! make unix >> "$LOG" 2>&1; then
            log "$REPO_NAME: BUILD FAILED, keeping old binary"
            return 1
        fi
    fi

    # Get currently occupied instances
    local occupied
    occupied=$(get_occupied_instances)

    log "$REPO_NAME: restarting idle instances..."
    local restarted=0
    local skipped=0
    for NUM in 1 2 3 4 5; do
        INST="${POOL_PREFIX}${NUM}"
        PID_FILE="/run/try-clavastack/${INST}/micropython.pid"

        if [ ! -f "$PID_FILE" ]; then
            continue
        fi

        PID=$(cat "$PID_FILE")
        if ! kill -0 "$PID" 2>/dev/null; then
            continue
        fi

        # Check if this instance is occupied
        if echo "$occupied" | grep -qx "$INST"; then
            log "Skipping $INST (occupied) - will update on session idle-reset"
            skipped=$((skipped + 1))
            continue
        fi

        log "Restarting $INST (idle)..."
        "$RESTART_SCRIPT" "$INST" restart >> "$LOG" 2>&1
        restarted=$((restarted + 1))
    done

    log "$REPO_NAME: update complete (now at ${REMOTE:0:10}), restarted=$restarted skipped=$skipped"
    return 0
}

log "=== Auto-update check started ==="

update_repo "/opt/try-clavastack/specter-diy"        "diy"       "specter-diy"
update_repo "/opt/try-clavastack/specter-playground"  "play"      "specter-playground"
update_repo "/opt/try-clavastack/specter-schnuartz"   "schnuartz" "specter-schnuartz"

log "=== Auto-update check finished ==="
