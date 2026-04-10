# VPS Config — Specter Simulator Pool

Multi-user simulator pool with 3 simulator types, auto-scaling (min 2, max 5 per type).

## Pool Components

| Datei | Pfad auf VPS | Beschreibung |
|-------|-------------|--------------|
| `Caddyfile` | `/etc/caddy/Caddyfile` | Caddy Reverse Proxy (15 WS routes) |
| `pool/server.py` | `/opt/try-clavastack/pool/server.py` | Multi-Pool Allocator API (Port 9001) |
| `pool/restart-simulator.sh` | `/opt/try-clavastack/pool/restart-simulator.sh` | Start/Stop/Restart per Instanz |
| `pool/auto-update.sh` | `/opt/try-clavastack/pool/auto-update.sh` | Auto-Pull von GitHub (alle 15 Min) |

## Simulator Types

| Pool | Repo | Display Range | VNC Ports | WS Ports |
|------|------|---------------|-----------|----------|
| `diy` | `cryptoadvance/specter-diy` | `:99`–`:103` | 5900–5904 | 6080–6084 |
| `play` | `k9ert/specter-playground` | `:110`–`:114` | 5910–5914 | 6090–6094 |
| `schnuartz` | `schnuartz-ai/specter-playground-schnuartz` | `:120`–`:124` | 5920–5924 | 6100–6104 |

## API Endpoints

- `POST /api/allocate` — Body: `{"pool": "diy"|"play"|"schnuartz"}` → Session zuweisen
- `POST /api/heartbeat` — Body: `{"sessionId": "..."}` → Session verlängern
- `POST /api/release` — Body: `{"sessionId": "..."}` → Session freigeben
- `POST /{pool}/sim/{1-5}/restart` — Instanz neustarten
- `GET /api/status` — Pool-Übersicht

## systemd Services

- `try-diy{1-5}.service` — Specter DIY Instanzen
- `try-play{1-5}.service` — Playground Instanzen
- `try-schnuartz{1-5}.service` — Schnuartz Instanzen
- `try-allocator.service` — Allocator API
- `try-auto-update.timer` — GitHub Auto-Update (alle 15 Min)
