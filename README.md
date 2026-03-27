# try-clavastack — Specter DIY Simulator

[![Live Demo](https://img.shields.io/badge/Live%20Demo-try.clavastack.com-orange?style=for-the-badge)](https://try.clavastack.com)
[![Specter3 Testing](https://img.shields.io/badge/Specter3%20Testing-WIP-red?style=for-the-badge)](https://try.clavastack.com/specter3-testing/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/Hosted%20on-GitHub%20Pages-black?style=for-the-badge&logo=github)](https://github.com/schnuartz-ai/try-clavastack)

> **"Try Before You Buy"** — Run a real Specter DIY Bitcoin Hardware Wallet in your browser. No hardware required.

---

## What Is This?

**Specter DIY** is an open-source Bitcoin hardware wallet you can build yourself or buy pre-assembled. Before investing in hardware, you can now try the actual firmware — running live in your browser.

This repository hosts the **frontend** for two interactive simulators:

| Simulator | URL | Status |
|-----------|-----|--------|
| **Original Specter DIY** | [try.clavastack.com](https://try.clavastack.com) | ✅ Stable |
| **Specter 3 Testing** | [try.clavastack.com/specter3-testing](https://try.clavastack.com/specter3-testing/) | ⚠️ WIP / Developer Preview |

> ⚠️ **Specter 3 is under active development.** Many screens are incomplete, some flows use temporary workarounds, and the UI will change significantly before release. It is a developer preview — not representative of the final product. Known limitations: Create Seed/Wallet screens are placeholders; some navigation uses temporary hacks; not all menu items are functional yet.

Both simulators stream a live VNC session directly into your browser via **noVNC** — you're interacting with **real firmware**, not a mockup.

---

## Quick Start (Demo)

1. Open [try.clavastack.com](https://try.clavastack.com)
2. Click on the screen to interact
3. **PIN setup:** You will be asked to choose a PIN — enter any 4+ digit code twice to confirm
   - The PIN is session-only and resets on restart
4. Navigate the wallet menus — Settings, Interfaces, Security, Generate Seed
5. Click **🔄 Restart Simulator** to reset to a fresh state

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Browser (noVNC)                              │
└───────────────────────┬──────────────────────┬───────────────────────┘
                        │ WSS /simulator-ws    │ WSS /playground-ws
                        ▼                      ▼
          ┌─────────────────────────────────────────────────┐
          │         Caddy Reverse Proxy (HTTPS + WSS)        │
          │         postiz.clavastack.com                    │
          └──────────┬──────────────────────────┬───────────┘
                     │ :6080                    │ :6081
                     ▼                          ▼
          ┌─────────────────┐       ┌─────────────────┐
          │   websockify    │       │   websockify    │
          └────────┬────────┘       └────────┬────────┘
                   │ TCP:5900                │ TCP:5901
                   ▼                         ▼
          ┌─────────────────┐       ┌─────────────────┐
          │    x11vnc       │       │    x11vnc       │
          └────────┬────────┘       └────────┬────────┘
                   │ Display :99             │ Display :100
                   ▼                         ▼
          ┌─────────────────┐       ┌─────────────────┐
          │     Xvfb :99    │       │     Xvfb :100   │
          └────────┬────────┘       └────────┬────────┘
                   ▼                         ▼
          ┌─────────────────┐       ┌─────────────────┐
          │ MicroPython Unix│       │ MicroPython Unix│
          │  specter-diy/   │       │specter-playground│
          │  (LVGL v7)      │       │  (LVGL v9)      │
          └─────────────────┘       └─────────────────┘
```

### Restart API

```
POST /restart/sim1   → Restart Original Specter DIY (clears session state)
POST /restart/sim2   → Restart Playground
POST /restart/both   → Restart both simulators
```

---

## Repository Structure

```
try-clavastack/
├── index.html                    # Original Specter DIY Simulator page
├── specter3-testing/
│   └── index.html                # Specter3 / Playground Testing page
├── assets/
│   ├── clavastack-logo.png
│   └── specter-logo.png
├── vps-config/
│   ├── README.md                 # VPS-specific documentation
│   ├── Caddyfile                 # Caddy Reverse Proxy config
│   ├── restart-api.py            # HTTP Restart API (Port 8095)
│   ├── restart-simulator.sh      # Shell restart script (clears fs/ on restart)
│   └── specter-diy/
│       ├── run_simulator.py      # MicroPython wrapper (fixes recursion depth)
│       └── asyncio-eintr-patch.md
└── CNAME                         # try.clavastack.com
```

---

## Self-Hosting Guide

### Prerequisites

- Ubuntu/Debian server (**4 GB RAM minimum**, 8 GB recommended for both simulators)
- A domain with DNS pointing to your server
- `gcc`, `make`, `cmake`, `python3`, `git`
- `Xvfb`, `x11vnc`, `websockify`
- `caddy` (reverse proxy with automatic HTTPS)

### 1. Install Dependencies

```bash
sudo apt update
sudo apt install -y build-essential cmake git python3 python3-pip
sudo apt install -y xvfb x11vnc
sudo apt install -y pkg-config libsdl2-dev libsdl2-image-dev
pip3 install websockify

# Caddy (choose one):
sudo snap install caddy --classic
# or:
sudo apt install caddy
```

### 2. Install noVNC

```bash
sudo apt install -y novnc
# or:
git clone https://github.com/novnc/noVNC.git /usr/share/novnc
```

### 3. Clone This Repository

```bash
git clone https://github.com/schnuartz-ai/try-clavastack.git
cd try-clavastack
```

### 4. Build the Simulators

> ⚠️ **Important:** The two simulators use **incompatible LVGL versions** (v7 vs v9) and **must be built separately** with their own binaries.

#### Simulator 1 — Original Specter DIY (LVGL v7)

```bash
git clone --depth 1 https://github.com/cryptoadvance/specter-diy.git
cd specter-diy
git submodule update --init --recursive --depth 1
make mpy-cross
make unix
```

**Required: Apply the asyncio EINTR patch** to `f469-disco/libs/common/asyncio/core.py`:

```python
# Before:
def wait_io_event(self, dt):
    for s, ev in self.poller.ipoll(dt):

# After:
def wait_io_event(self, dt):
    try:
        items = list(self.poller.ipoll(dt))
    except OSError:
        return
    for s, ev in items:
```

**Required: Use custom `run_simulator.py`** (fixes MicroPython recursion depth limit):

```python
import sys
sys.path.append('./src')
sys.path.append('./f469-disco/libs/common')
sys.path.append('./f469-disco/libs/unix')
sys.path.append('./f469-disco/usermods/udisplay_f469/display_unixport')

# Pre-import all deep modules to avoid recursion depth issues
import hashlib
import microur.util.xoshiro256
import microur.util.random_sampler
import microur.util.fountain
import microur.util.ur
import microur.util.bytewords
import microur.encoder
import microur.decoder
import main
main.main()
```

See [`vps-config/specter-diy/run_simulator.py`](vps-config/specter-diy/run_simulator.py).

#### Simulator 2 — Specter Playground / Specter3 (LVGL v9)

```bash
git clone https://github.com/maggo83/specter-playground.git
cd specter-playground
git submodule update --init --recursive
make mpy-cross
make unix
make build-i18n   # Important: builds language files
```

### 5. Start All Services

```bash
# === Simulator 1: Original Specter DIY (Display :99) ===
Xvfb :99 -screen 0 480x800x24 -ac &
cd ~/specter-diy
# Copy run_simulator.py from vps-config/specter-diy/
DISPLAY=:99 ./bin/micropython_unix run_simulator.py &
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -quiet &
websockify --daemon 6080 localhost:5900

# === Simulator 2: Specter Playground (Display :100) ===
Xvfb :100 -screen 0 480x800x24 -ac &
cd ~/specter-playground
DISPLAY=:100 ./bin/micropython_unix scenarios/mockui_fw/main.py &
x11vnc -display :100 -forever -shared -nopw -rfbport 5901 -quiet &
websockify --daemon 6081 localhost:5901

# === Restart API ===
nohup python3 vps-config/restart-api.py &
```

Or use the included restart script:

```bash
chmod +x vps-config/restart-simulator.sh
# Starts both simulators (clears saved state for fresh demo experience)
./vps-config/restart-simulator.sh both
```

### 6. Configure Caddy

```bash
sudo cp vps-config/Caddyfile /etc/caddy/Caddyfile
# Replace all occurrences of "postiz.clavastack.com" with your domain:
sudo sed -i 's/postiz.clavastack.com/YOUR-DOMAIN/g' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 7. Update Frontend WebSocket URLs

In `index.html` and `specter3-testing/index.html`, update the WebSocket URLs:

```javascript
// Replace:
const url = `wss://postiz.clavastack.com/simulator-ws`;
// With:
const url = `wss://YOUR-DOMAIN/simulator-ws`;
```

Do the same for `/playground-ws` in `specter3-testing/index.html`.

### 8. Serve the Frontend

**Option A: GitHub Pages** (recommended)
1. Fork this repo
2. Enable GitHub Pages (Settings → Pages → Branch: main)
3. Add a `CNAME` file with your custom domain

**Option B: Caddy static files**
```bash
# Copy frontend to web root
sudo cp -r index.html specter3-testing/ assets/ /var/www/try-clavastack/
# Add to Caddyfile (already in vps-config/Caddyfile under try.clavastack.com block)
```

---

## Troubleshooting

### "Enter your PIN" but I don't know the PIN

The restart button on the page clears the saved state — click **🔄 Restart Simulator** and you'll get a fresh PIN setup screen.

### Simulator crashes on startup (recursion error)

Make sure you're using `run_simulator.py` (not `simulate.py`) with all pre-imports listed. See [vps-config/specter-diy/run_simulator.py](vps-config/specter-diy/run_simulator.py).

### asyncio hangs / EINTR errors

Apply the EINTR patch to `f469-disco/libs/common/asyncio/core.py`. See [vps-config/specter-diy/asyncio-eintr-patch.md](vps-config/specter-diy/asyncio-eintr-patch.md).

### Black / blank screen in browser

- MicroPython process not running? `ps aux | grep micropython`
- Wrong display number? `x11vnc` and simulator must use same `:99`/`:100`
- SDL2 missing? `sudo apt install libsdl2-dev libsdl2-image-dev`

### WebSocket connection fails

```bash
# Check processes
ps aux | grep -E "websockify|x11vnc|Xvfb|micropython"
# Check ports
ss -tlnp | grep -E "6080|6081|5900|5901"
# Check Caddy
sudo journalctl -u caddy -n 50
```

### Specter3 build fails (`make build-i18n`)

```bash
pip3 install babel
make build-i18n
```

### LVGL version mismatch

`specter-diy` uses **LVGL v7** and `specter-playground` uses **LVGL v9** — they are not compatible. Never swap the `micropython_unix` binaries between the two simulators.

---

## Contributing

Pull requests are welcome! This project uses **automated AI PR review** — your PR will be reviewed automatically within 15 minutes of submission.

### PR Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-improvement`
3. Make your changes
4. Open a Pull Request with a clear description
5. Automated review runs (injection check + code review)
6. Once approved, your PR is automatically merged

### What We Welcome

- UI/UX improvements to the simulator pages
- Mobile responsiveness improvements
- VPS configuration improvements (Caddyfile, systemd units)
- Documentation fixes and additions
- Better reconnection / error handling logic

### What Belongs Upstream

Firmware bugs should go to:
- [cryptoadvance/specter-diy](https://github.com/cryptoadvance/specter-diy) — Original firmware
- [maggo83/specter-playground](https://github.com/maggo83/specter-playground) — Specter v3 rework

---

## Related Repositories

| Repo | Purpose |
|------|---------|
| [cryptoadvance/specter-diy](https://github.com/cryptoadvance/specter-diy) | Original Specter DIY firmware (LVGL v7) |
| [maggo83/specter-playground](https://github.com/maggo83/specter-playground) | Specter v3 rework / playground (LVGL v9) |
| [novnc/noVNC](https://github.com/novnc/noVNC) | Browser-based VNC client |

---

## License

MIT License

This project is maintained by [ClavaStack](https://clavastack.com) — building open Bitcoin hardware for everyone.
