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

### Hardware bridge (per session, real Specter simulator I/O)

These are all narrowly scoped to the caller's *own* allocated `sessionId` —
resolved server-side to exactly one instance, never an arbitrary path/host.

- `GET  /api/session/{sessionId}/sd` — list files + insert state of the real `fs/sd`
- `POST /api/session/{sessionId}/sd/insert` / `.../sd/eject` — client-facing card state (the Unix simulator's SD driver always reports "present", so this only gates our own upload/delete UI, not the firmware)
- `POST /api/session/{sessionId}/sd/upload` — Body: `{"filename": "wallet.psbt", "data": "<base64>"}` (`.psbt`/`.txt`/`.json` only, 512KB cap, 25 files/session)
- `POST /api/session/{sessionId}/sd/delete` — Body: `{"filename": "..."}`
- `GET  /api/session/{sessionId}/sd/download?filename=...`
- `POST /api/session/{sessionId}/qr` — Body: `{"payload": "..."}` (≤32KB) — opens a fresh TCP connection to the firmware's own QR "UART" socket (see `restart-simulator.sh`) and writes the payload, exactly like a physical QR scanner module would. The firmware parses it through its normal QR code path.

`restart-simulator.sh` now also writes, per instance, under `/run/try-clavastack/<inst>/`:
- `sd_dir` — absolute path to that instance's real `fs/sd` directory
- `qr_port` — the TCP port the firmware's QR UART actually bound (scraped from its own boot log, since it auto-increments on a bind conflict rather than being fixed)

Tests: `pool/tests/test_hwbridge.py` (`python3 -m unittest pool.tests.test_hwbridge -v`). Set `SPECTER_SIM_QR_PORT=<port>` to also run a true end-to-end test against a locally built specter-diy Unix simulator.

## systemd Services

- `try-diy{1-5}.service` — Specter DIY Instanzen
- `try-play{1-5}.service` — Playground Instanzen
- `try-schnuartz{1-5}.service` — Schnuartz Instanzen
- `try-allocator.service` — Allocator API
- `try-auto-update.timer` — GitHub Auto-Update (alle 15 Min)
