#!/bin/bash
# Restart Simulator Script
# Usage: restart-simulator.sh [1|2|both]
SIM=${1:-both}

restart_sim1() {
    echo "Restarting Simulator 1 (Original Specter DIY)..."
    pkill -f "micropython.*run_simulator" 2>/dev/null
    pkill -f "x11vnc.*5900" 2>/dev/null
    pkill -f "websockify.*6080" 2>/dev/null
    pkill -f "Xvfb :99" 2>/dev/null
    sleep 2
    
    cd ~/specter-diy
    # Clear saved state so demo starts fresh (no PIN lock-out)
    rm -rf ./fs/
    
    Xvfb :99 -screen 0 480x800x24 -ac &
    sleep 1
    DISPLAY=:99 ./bin/micropython_unix run_simulator.py &
    sleep 5
    x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -quiet &
    sleep 1
    websockify --daemon --log-file=/tmp/ws1.log 6080 localhost:5900
    echo "Sim1 OK"
}

restart_sim2() {
    echo "Restarting Simulator 2 (Playground)..."
    pkill -f "micropython.*mockui" 2>/dev/null
    pkill -f "x11vnc.*5901" 2>/dev/null
    pkill -f "websockify.*6081" 2>/dev/null
    pkill -f "Xvfb :100" 2>/dev/null
    sleep 2
    
    cd ~/specter-playground
    
    Xvfb :100 -screen 0 480x800x24 -ac &
    sleep 1
    DISPLAY=:100 ./bin/micropython_unix scenarios/mockui_fw/main.py &
    sleep 5
    x11vnc -display :100 -forever -shared -nopw -rfbport 5901 -quiet &
    sleep 1
    websockify --daemon --log-file=/tmp/ws2.log 6081 localhost:5901
    echo "Sim2 OK"
}

case "$SIM" in
    1) restart_sim1 ;;
    2) restart_sim2 ;;
    both) restart_sim1; restart_sim2 ;;
esac
echo "DONE"
