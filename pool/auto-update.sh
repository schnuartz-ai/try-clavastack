#!/bin/bash
# Auto-update script: checks each repo for new commits, pulls, and restarts affected instances.
# Runs via systemd timer (e.g. every 15 minutes).

LOG="/var/log/simulators/auto-update.log"
RESTART_SCRIPT="/opt/try-clavastack/pool/restart-simulator.sh"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

update_repo() {
    local REPO_DIR="$1"
    local POOL_PREFIX="$2"
    local REPO_NAME="$3"

    cd "$REPO_DIR" || { log "ERROR: cannot cd to $REPO_DIR"; return 1; }

    # Fetch latest from origin
    git fetch origin 2>/dev/null

    # Get current and remote HEAD
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/$(git symbolic-ref --short HEAD 2>/dev/null || echo main))

    if [ "$LOCAL" = "$REMOTE" ]; then
        log "$REPO_NAME: up to date ($LOCAL)"
        return 0
    fi

    log "$REPO_NAME: update available ($LOCAL -> $REMOTE)"

    # Pull changes
    git reset --hard "$REMOTE" >> "$LOG" 2>&1

    # Check if binary needs rebuild (if Makefile has unix target)
    if [ -f Makefile ] && grep -q "^unix:" Makefile; then
        log "$REPO_NAME: rebuilding micropython_unix..."
        make unix >> "$LOG" 2>&1
        if [ $? -ne 0 ]; then
            log "$REPO_NAME: BUILD FAILED, keeping old binary"
        fi
    fi

    # Restart all running instances of this pool
    log "$REPO_NAME: restarting instances..."
    for NUM in 1 2 3 4 5; do
        INST="${POOL_PREFIX}${NUM}"
        PID_FILE="/run/try-clavastack/${INST}/micropython.pid"
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if kill -0 "$PID" 2>/dev/null; then
                log "Restarting $INST..."
                "$RESTART_SCRIPT" "$INST" restart >> "$LOG" 2>&1
            fi
        fi
    done

    log "$REPO_NAME: update complete (now at $REMOTE)"
    return 0
}

log "=== Auto-update check started ==="

update_repo "/opt/try-clavastack/specter-diy" "diy" "specter-diy"
update_repo "/opt/try-clavastack/specter-playground" "play" "specter-playground"
update_repo "/opt/try-clavastack/specter-schnuartz" "schnuartz" "specter-schnuartz"

log "=== Auto-update check finished ==="
