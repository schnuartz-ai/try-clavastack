# VPS Config — Specter Simulator

Diese Dateien laufen auf dem Hetzner VPS (`89.167.19.144`, User: `finn`).

## Dateien

| Datei | Pfad auf VPS | Beschreibung |
|-------|-------------|--------------|
| `Caddyfile` | `/etc/caddy/Caddyfile` | Caddy Reverse Proxy Config |
| `restart-api.py` | `~/restart-api.py` | HTTP API zum Neustarten der Simulatoren (Port 8095) |
| `restart-simulator.sh` | `~/restart-simulator.sh` | Shell-Script zum Neustarten |
| `specter-diy/run_simulator.py` | `~/specter-diy/run_simulator.py` | MicroPython Wrapper mit Pre-Imports für Specter DIY |

## Simulatoren

| Display | Port VNC | Port WS | Simulator |
|---------|----------|---------|-----------|
| `:99` | 5900 | 6080 | Original Specter DIY (`~/specter-diy/`) |
| `:100` | 5901 | 6081 | Playground/Specter3 (`~/specter-playground/`) |

## WebSocket Endpoints (via postiz.clavastack.com)

- `wss://postiz.clavastack.com/simulator-ws` → Specter DIY
- `wss://postiz.clavastack.com/playground-ws` → Playground
- `https://postiz.clavastack.com/restart/sim1` → Simulator 1 neustarten
- `https://postiz.clavastack.com/restart/sim2` → Simulator 2 neustarten
