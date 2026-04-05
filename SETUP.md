# Specter DIY Browser Simulator - Complete Setup Guide

This repository contains a browser-based simulator for the Specter DIY Bitcoin Hardware Wallet. This guide enables AI agents or developers to deploy and reproduce the entire setup.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [VPS Setup (Simulator Backend)](#vps-setup-simulator-backend)
4. [GitHub Pages Setup (Frontend)](#github-pages-setup-frontend)
5. [File Structure](#file-structure)
6. [Configuration Reference](#configuration-reference)
7. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

The system consists of two main components:

1. **VPS Backend**: Runs the actual Specter DIY simulator (MicroPython + LVGL + X11VNC)
2. **GitHub Pages Frontend**: Browser-based noVNC client that connects to the VPS

```
User Browser → GitHub Pages (noVNC client) → VPS WebSocket → X11VNC → Specter Simulator
```

---

## Prerequisites

### VPS Requirements

- Linux server (Ubuntu 22.04+ recommended)
- **RAM**: 2GB minimum, 4GB recommended (each simulator uses ~300MB)
- **Ports**: 5900 (VNC), 6080 (WebSocket proxy), optional 6081+ (additional simulators)

### Software Required

```bash
# On VPS:
sudo apt update
sudo apt install -y xvfb x11vnc websockify python3 git imagemagick
```

### Domain/DNS

- A domain or subdomain pointing to your VPS
- SSL certificate (via Caddy, nginx, or Let's Encrypt)

---

## VPS Setup (Simulator Backend)

### Step 1: Install Specter DIY Simulator

```bash
# Clone the simulator repository
cd ~
git clone https://github.com/cryptoadvance/specter-diy.git
cd specter-diy

# Download MicroPython binary for Unix
wget https://github.com/cryptoadvance/specter-diy/releases/download/v1.8.0/micropython_unix -O bin/micropython_unix
chmod +x bin/micropython_unix

# The simulator will use a virtual framebuffer (Xvfb)
```

### Step 2: Create Simulator Startup Script

Create `~/restart-simulator.sh`:

```bash
#!/bin/bash
# Restart Simulator Script

SIM=${1:-1}

restart_sim1() {
    echo "Restarting Simulator 1 (Specter DIY)..."
    pkill -f "micropython.*run_simulator" 2>/dev/null
    pkill -f "x11vnc.*5900" 2>/dev/null
    pkill -f "websockify.*6080" 2>/dev/null
    pkill -f "Xvfb :99" 2>/dev/null
    sleep 2
    
    cd ~/specter-diy
    # Clear saved state for demo
    rm -rf ./fs/
    
    Xvfb :99 -screen 0 480x800x24 -ac &
    sleep 1
    DISPLAY=:99 ./bin/micropython_unix run_simulator.py &
    sleep 5
    x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -noxdamage -quiet &
    sleep 1
    websockify --daemon --log-file=/tmp/ws1.log 6080 localhost:5900
    echo "Sim1 OK"
}

case "$SIM" in
    1) restart_sim1 ;;
    *) restart_sim1 ;;
esac
```

Make it executable:
```bash
chmod +x ~/restart-simulator.sh
```

### Step 3: Start the Simulator

```bash
~/restart-simulator.sh 1
```

Verify it's running:
```bash
ps aux | grep -E "micropython|x11vnc|websockify" | grep -v grep
```

### Step 4: Configure Reverse Proxy (Caddy Example)

Create `/etc/caddy/Caddyfile` or `~/Caddyfile`:

```caddy
yourdomain.com {
    # WebSocket for simulator
    @simws path /simulator-ws
    handle @simws {
        uri strip_prefix /simulator-ws
        reverse_proxy localhost:6080
    }
    
    # Optional: local noVNC files
    handle_path /simulator-novnc/* {
        root * /usr/share/novnc
        file_server
        header Access-Control-Allow-Origin "*"
    }
    
    # Default: GitHub Pages (or your frontend)
    handle {
        reverse_proxy localhost:4000  # or your static server
    }
}
```

Start Caddy:
```bash
caddy run --config ~/Caddyfile
```

---

## GitHub Pages Setup (Frontend)

### Step 1: Repository Structure

```
repo-root/
├── index.html              # Main simulator view
├── device-test/
│   └── index.html          # Mobile-optimized device view
├── specter3-testing/
│   └── index.html          # Optional: Specter3 variant
├── novnc/                  # noVNC library (v1.5.0)
│   └── core/
│       └── rfb.js          # Core VNC client
└── assets/
    ├── phone-mockup.png    # Device mockup image
    ├── clavastack-logo.png
    └── specter-logo.png
```

### Step 2: Configure noVNC

Download noVNC locally (don't rely on VPS version):

```bash
cd your-repo-root
wget https://github.com/novnc/noVNC/archive/refs/tags/v1.5.0.tar.gz
mkdir -p novnc
tar -xzf v1.5.0.tar.gz --strip-components=1 -C novnc
```

### Step 3: Basic HTML Structure

Create `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Specter DIY Simulator</title>
  <style>
    :root {
      --specter-dark: #04070B;
      --specter-light: #FCFCFC;
      --specter-primary: #1F99E5;
      --specter-coral: #FF7A7A;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--specter-dark);
      color: var(--specter-light);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 20px;
    }
    #sim-container {
      position: relative;
      width: 100%;
      max-width: 400px;
      height: 80vh;
      border-radius: 8px;
      overflow: hidden;
      background: #000;
    }
    #status {
      margin-top: 12px;
      font-size: 13px;
      opacity: 0.7;
    }
    .restart-btn {
      margin-top: 16px;
      padding: 12px 24px;
      border-radius: 999px;
      background: transparent;
      color: var(--specter-coral);
      border: 2px solid var(--specter-coral);
      cursor: pointer;
    }
    .restart-btn:disabled { opacity: 0.5; }
    footer {
      margin-top: auto;
      padding: 20px;
      font-size: 12px;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <header>
    <h1>Specter DIY Simulator</h1>
    <div class="status" id="status">Connecting...</div>
  </header>
  
  <div id="sim-container">
    <div id="loading">Loading simulator...</div>
  </div>
  
  <button class="restart-btn" id="restart-btn">Restart Simulator</button>
  
  <footer>
    <a href="https://github.com/cryptoadvance/specter-diy">GitHub</a>
  </footer>

  <script type="module">
    // CONFIGURATION: Update these for your setup
    const CONFIG = {
      // Your WebSocket URL - must be wss:// for HTTPS pages
      wsUrl: 'wss://YOUR-DOMAIN.com/simulator-ws',
      // Restart API endpoint (optional)
      restartUrl: 'https://YOUR-DOMAIN.com/restart/sim1'
    };

    import RFB from '/novnc/core/rfb.js';
    
    const container = document.getElementById('sim-container');
    const status = document.getElementById('status');
    
    let rfb;
    
    function connect() {
      try {
        rfb = new RFB(container, CONFIG.wsUrl);
        rfb.scaleViewport = true;
        rfb.clipViewport = true;
        rfb.viewOnly = false;
        rfb.qualityLevel = 6;
        rfb.compressionLevel = 2;
        
        rfb.addEventListener('connect', () => {
          status.textContent = 'Connected';
          status.style.color = '#4c5';
        });
        
        rfb.addEventListener('disconnect', () => {
          status.textContent = 'Disconnected - Click Restart';
          status.style.color = '#f44';
        });
      } catch(e) {
        status.textContent = 'Error: ' + e.message;
      }
    }
    
    document.getElementById('restart-btn').addEventListener('click', () => {
      if (CONFIG.restartUrl) {
        fetch(CONFIG.restartUrl, { method: 'POST' }).catch(() => {});
      }
      setTimeout(() => location.reload(), 5000);
    });
    
    connect();
  </script>
</body>
</html>
```

### Step 4: Enable GitHub Pages

1. Go to repository Settings → Pages
2. Source: Deploy from a branch
3. Branch: `main` / `root`
4. Save

---

## File Structure

```
~/specter-diy/                    # VPS: Simulator backend
├── bin/micropython_unix          # MicroPython binary
├── run_simulator.py              # Entry point
└── restart-simulator.sh          # Management script

~/Caddyfile                       # VPS: Reverse proxy config

/var/www/html/                    # Or GitHub Pages repo
├── index.html                    # Main simulator UI
├── novnc/                        # noVNC library
│   └── core/rfb.js
└── assets/
    └── [mockup images]
```

---

## Configuration Reference

### Environment Variables

No sensitive env vars required - all config is in:
- `CONFIG.wsUrl` in HTML
- `CONFIG.restartUrl` in HTML (optional)
- `~/Caddyfile` on VPS (domain-specific)

### Port Reference

| Service | Port | Protocol |
|---------|------|----------|
| X11VNC | 5900 | TCP (localhost only) |
| WebSocket Proxy | 6080 | TCP |
| Caddy/HTTPS | 443 | Public |

---

## Troubleshooting

### Black Screen
- Check `x11vnc` is running with `-noxdamage` flag
- Verify WebSocket connection in browser DevTools
- Check `websockify` logs: `tail -f /tmp/ws1.log`

### Simulator Crashes
- Restart: `~/restart-simulator.sh 1`
- Check MicroPython logs: `tail -f /tmp/sim1.log`

### Connection Failed
- Ensure CORS headers are set on reverse proxy
- Verify WebSocket URL uses `wss://` for HTTPS pages
- Check firewall: ports 443 and 6080 must be open

### Device Not Visible
- Screenshot test: `DISPLAY=:99 scrot /tmp/test.png`
- Check Xvfb: `Xvfb :99 -screen 0 480x800x24 -ac &`

---

## Security Notes

- NO API keys required - this is a self-contained system
- VNC runs on localhost only (5900), not exposed publicly
- WebSocket proxy required for browser access
- Always use `wss://` (secure WebSocket) in production
- Consider basic auth on restart endpoint

---

## License

Specter DIY is licensed under MIT. This setup guide is provided as reference implementation only.

---

*Last updated: 2025*
*Tested on: Ubuntu 22.04, MicroPython 1.22+*