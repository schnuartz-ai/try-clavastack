#!/bin/bash
set -e

# Usage: ./restart-simulator.sh <instance-id> [start|stop|restart]
# Instance IDs: diy1-diy5, play1-play5, schnuartz1-schnuartz5

INST_ID=$1
ACTION=${2:-restart}

if [[ -z "$INST_ID" ]]; then
    echo "Usage: $0 <instance-id> [start|stop|restart]"
    echo "  IDs: diy{1-5}, play{1-5}, schnuartz{1-5}"
    exit 1
fi

# Parse type and number
if [[ "$INST_ID" =~ ^diy([0-9][0-9]*)$ ]]; then
    TYPE="diy"; NUM="${BASH_REMATCH[1]}"
    BASE_DIR="/opt/try-clavastack/specter-diy"
    RUN_CMD="./bin/micropython_unix run_simulator.py"
elif [[ "$INST_ID" =~ ^play([1-5])$ ]]; then
    TYPE="play"; NUM="${BASH_REMATCH[1]}"
    BASE_DIR="/opt/try-clavastack/specter-playground"
    RUN_CMD="./bin/micropython_unix scenarios/mockui_fw/main.py"
elif [[ "$INST_ID" =~ ^schnuartz([1-5])$ ]]; then
    TYPE="schnuartz"; NUM="${BASH_REMATCH[1]}"
    BASE_DIR="/opt/try-clavastack/specter-schnuartz"
    RUN_CMD="./bin/micropython_unix scenarios/mockui_fw/main.py"
else
    echo "Unknown instance: $INST_ID"; exit 1
fi

# Port mapping: type base + instance number
case $TYPE in
    diy)
        DISPLAY_NUM=$((98 + NUM))   # :99 - :103
        VNC_BASE=5899               # 5900 - 5904
        WS_BASE=6079                # 6080 - 6084
        ;;
    play)
        DISPLAY_NUM=$((109 + NUM))  # :110 - :114
        VNC_BASE=5909               # 5910 - 5914
        WS_BASE=6089                # 6090 - 6094
        ;;
    schnuartz)
        DISPLAY_NUM=$((119 + NUM))  # :120 - :124
        VNC_BASE=5919               # 5920 - 5924
        WS_BASE=6099                # 6100 - 6104
        ;;
esac

XDISPLAY=":${DISPLAY_NUM}"
VNC_PORT=$((VNC_BASE + NUM))
WS_PORT=$((WS_BASE + NUM))

FS_DIR="/opt/try-clavastack/pool/${INST_ID}/fs"
PID_DIR="/run/try-clavastack/${INST_ID}"
LOG_DIR="/var/log/simulators"

mkdir -p "$PID_DIR" "$LOG_DIR" "$FS_DIR"

kill_pid_file() {
    local pf="$1"
    if [[ -f "$pf" ]]; then
        local pid=$(cat "$pf" 2>/dev/null)
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            sleep 0.5
            kill -9 "$pid" 2>/dev/null || true
        fi
        rm -f "$pf"
    fi
}

# Kill any process listening on a specific port (catch orphans not tracked by PID files)
kill_port() {
    local port="$1"
    local pids=$(ss -tlnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u)
    for pid in $pids; do
        echo "Killing orphan process $pid on port $port"
        kill "$pid" 2>/dev/null || true
        sleep 0.3
        kill -9 "$pid" 2>/dev/null || true
    done
}

# Kill any Xvfb on our display (catch orphans)
kill_display() {
    local display="$1"
    local pids=$(pgrep -f "Xvfb $display " 2>/dev/null || true)
    for pid in $pids; do
        echo "Killing orphan Xvfb $pid on display $display"
        kill "$pid" 2>/dev/null || true
        sleep 0.3
        kill -9 "$pid" 2>/dev/null || true
    done
}

stop_inst() {
    echo "Stopping $INST_ID..."
    # First try PID files (clean path)
    kill_pid_file "$PID_DIR/micropython.pid"
    kill_pid_file "$PID_DIR/websockify.pid"
    kill_pid_file "$PID_DIR/x11vnc.pid"
    kill_pid_file "$PID_DIR/xvfb.pid"
    sleep 0.5
    # Then kill any orphans by port/display (catches leaked processes)
    kill_port "$WS_PORT"
    kill_port "$VNC_PORT"
    kill_display "$XDISPLAY"
    sleep 0.5
    echo "$INST_ID stopped."
}

start_inst() {
    echo "Starting $INST_ID (type=$TYPE, display=$XDISPLAY, vnc=$VNC_PORT, ws=$WS_PORT)..."

    rm -rf "$FS_DIR"
    mkdir -p "$FS_DIR" "$FS_DIR/sd"
    rm -f "$PID_DIR/qr_port" "$PID_DIR/sd_dir"

    Xvfb "$XDISPLAY" -screen 0 480x800x24 -ac &
    echo $! > "$PID_DIR/xvfb.pid"
    sleep 1

    x11vnc -display "$XDISPLAY" -forever -shared -nopw -rfbport $VNC_PORT -quiet &
    echo $! > "$PID_DIR/x11vnc.pid"
    sleep 1

    websockify --web=/usr/share/novnc/ $WS_PORT localhost:$VNC_PORT &
    echo $! > "$PID_DIR/websockify.pid"
    sleep 1

    cd "$BASE_DIR"
    : > "$LOG_DIR/$INST_ID.log"
    DISPLAY="$XDISPLAY" $RUN_CMD > "$LOG_DIR/$INST_ID.log" 2>&1 &
    echo $! > "$PID_DIR/micropython.pid"

    # The firmware's QR "scanner" is a real TCP-UART socket it opens itself
    # (see f469-disco/libs/unix/pyb.py). It normally binds a fixed port
    # derived from the UART name ("YA" -> 22849), but auto-increments on a
    # bind conflict, so the actual port is not guaranteed across instances.
    # The firmware logs the real bound port on the very first
    # "Running TCP-UART" line (the QR host is constructed before any other
    # simulated UART) - scrape that instead of assuming a fixed port.
    QR_PORT=""
    for i in $(seq 1 50); do
        QR_PORT=$(grep -m1 "Running TCP-UART on 127.0.0.1 port" "$LOG_DIR/$INST_ID.log" 2>/dev/null | grep -oP 'port \K[0-9]+')
        [[ -n "$QR_PORT" ]] && break
        sleep 0.2
    done
    if [[ -n "$QR_PORT" ]]; then
        echo "$QR_PORT" > "$PID_DIR/qr_port"
        echo "$INST_ID QR TCP bridge on port $QR_PORT"
    else
        echo "WARNING: $INST_ID did not report a QR TCP port in time"
    fi
    echo "$FS_DIR/sd" > "$PID_DIR/sd_dir"

    echo "$INST_ID started (pids: xvfb=$(cat $PID_DIR/xvfb.pid), vnc=$(cat $PID_DIR/x11vnc.pid), ws=$(cat $PID_DIR/websockify.pid), mp=$(cat $PID_DIR/micropython.pid))"
}

restart_inst() {
    stop_inst
    sleep 2
    start_inst
}

case $ACTION in
    start)   start_inst ;;
    stop)    stop_inst ;;
    restart) restart_inst ;;
    *) echo "Unknown action: $ACTION"; exit 1 ;;
esac
