# VPS Config — Browser Simulator and Legacy Pool

The default `try.clavastack.com` page and `/simulators/` now run Specter
WebAssembly in the visitor's browser. Caddy serves static pages, versioned
builds, and the required COOP/COEP/CORP headers. The pool below remains for
`/legacy/` and `/simulators/legacy/` rollback. See [the browser setup guide](../SETUP.md).

The complete tested site is published as a checksummed GitHub release asset and
pulled by `try-browser-auto-deploy.timer`. It is installed below
`/var/www/try-clavastack-deploy/releases/` and activated with an atomic
`current` symlink. See [`deploy/install-server.sh`](../deploy/install-server.sh) and the repository-level
`SETUP.md`. Do not stop the pool services until browser mode has been proven
stable and rollback is retired.

Multi-user simulator pool with 3 simulator types, auto-scaling (min 2, max 5 per type).

## Pool Components

| Datei | Pfad auf VPS | Beschreibung |
|-------|-------------|--------------|
| `Caddyfile` | `/etc/caddy/Caddyfile` | Caddy Reverse Proxy (15 WS routes) |
| `pool/server.py` | `/opt/try-clavastack/pool/server.py` | Multi-Pool Allocator API (Port 9001) |
| `pool/restart-simulator.sh` | `/opt/try-clavastack/pool/restart-simulator.sh` | Start/Stop/Restart per Instanz |
| `deploy/deploy-site-release.sh` | `/usr/local/libexec/try-clavastack/deploy-site-release.sh` | Pull and atomically activate tested GitHub releases |
| `pool/auto-update.sh` | `/opt/try-clavastack/pool/auto-update.sh` | Legacy simulator source updater |

## Simulator Types

| Pool | Repo | Display Range | VNC Ports | WS Ports |
|------|------|---------------|-----------|----------|
| `diy` | `cryptoadvance/specter-diy` | `:99`–`:103` | 5900–5904 | 6080–6084 |
| `play` | `k9ert/specter-playground` | `:110`–`:114` | 5910–5914 | 6090–6094 |
| `schnuartz` | `Schnuartz/specter-playground` | `:120`–`:124` | 5920–5924 | 6100–6104 |

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
- `try-browser-auto-deploy.timer` — vollständiges GitHub-Release-Deployment (alle 2 Min)
- `try-auto-update.timer` — alter Simulator-Quellcode-Updater; nach der Migration deaktiviert
