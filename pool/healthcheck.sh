#!/usr/bin/env bash
set -euo pipefail

# Healthcheck for try.clavastack.com simulator pool system
# Runs via systemd timer every 5 minutes.
# Unlike the old version, this does NOT restart the allocator when pools are low.
# Instead it starts individual missing instances directly.

ALLOCATOR_URL="http://127.0.0.1:9001/api/status"
WEB_URL="http://127.0.0.1"

declare -A MIN_INSTANCES=(
    [diy]=3
    [play]=2
    [schnuartz]=2
)

failed=0

# --- Check Caddy / web server ---
if ! curl -fsS --max-time 10 "$WEB_URL" >/dev/null 2>&1; then
    echo "FAIL: web server (caddy) is down"
    failed=1
fi

# --- Check allocator API ---
STATUS=""
if ! STATUS=$(curl -fsS --max-time 5 "$ALLOCATOR_URL" 2>/dev/null); then
    echo "FAIL: allocator API is down, restarting allocator"
    systemctl restart try-allocator.service
    failed=1
fi

# --- Check pool instance counts (only if allocator responded) ---
if [ "$failed" -eq 0 ] && [ -n "$STATUS" ]; then
    for pool in "${!MIN_INSTANCES[@]}"; do
        min=${MIN_INSTANCES[$pool]}
        running=$(echo "$STATUS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('$pool', {}).get('runningCount', 0))
" 2>/dev/null || echo 0)

        if [ "$running" -lt "$min" ]; then
            echo "WARN: $pool has $running/$min running instances, starting missing ones"

            # Find instances that are not running
            INSTANCE_IDS=$(echo "$STATUS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
pool_data = d.get('$pool', {})
for inst in pool_data.get('instances', []):
    if not inst.get('running', False):
        print(inst.get('id', ''))
" 2>/dev/null)

            started=0
            needed=$((min - running))
            while IFS= read -r instance_id; do
                [ -z "$instance_id" ] && continue
                if [ "$started" -ge "$needed" ]; then
                    break
                fi
                echo "Starting instance $instance_id"
                systemctl restart "try-${instance_id}.service" || {
                    echo "FAIL: could not restart try-${instance_id}.service"
                    failed=1
                }
                started=$((started + 1))
            done <<< "$INSTANCE_IDS"

            if [ "$started" -lt "$needed" ]; then
                echo "WARN: could only start $started/$needed missing instances for $pool"
            fi
        fi
    done
fi

# --- RAM monitoring ---
free_mb=$(awk '/MemAvailable:/ { printf "%d", $2/1024 }' /proc/meminfo 2>/dev/null || echo 0)
if [ "$free_mb" -lt 200 ]; then
    echo "WARN: low memory - only ${free_mb}MB available (threshold: 200MB)"
fi

if [ "$failed" -ne 0 ]; then
    exit 1
fi

echo "OK: all pools healthy (free RAM: ${free_mb}MB)"
