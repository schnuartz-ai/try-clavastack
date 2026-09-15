# Browser simulator setup and deployment

The default site is static. Its only server requirements are HTTPS, correct WASM MIME delivery, and the headers in [`vps-config/Caddyfile`](vps-config/Caddyfile). The legacy VNC routes remain configured for `/legacy/`.

## Local build

Run the commands in the [README](README.md#build-and-test) on Linux or WSL2. `browser/build-browser.sh` pins Specter commit `89431c644cc300c55b53220d262a31be02353969`, fetches its recursive submodules, requires Emscripten 3.1.74, and writes:

```text
browser/current.json
builds/Schnuartz/specter-diy/89431c644cc300c55b53220d262a31be02353969/
  micropython.js
  micropython.wasm
  micropython.data
  build-info.json
```

Build the other two pinned variants with `bash browser/build-playground.sh k9ert` and `bash browser/build-playground.sh schnuartz`. This compiles each fork's own LVGL 9 MockUI simulator, the same `scenarios/mockui_fw/main.py` application used by the legacy VNC services. It writes `browser/variants/*.json` and versioned artifacts under `builds/k9ert/specter-playground-mockui/<commit>/` and `builds/Schnuartz/specter-playground-mockui/<commit>/`. Run `python3 browser/verify-build.py` before publishing. Generated `micropython.*` files are derived from source and Git-ignored. Manifests contain SHA256 hashes; publish new assets before changing any pointer. The older `browser/build-playground-wallet.sh` is retained only for reproducing the superseded wallet-source experiment and is not used by CI or production.

Start a local static server from the repository root with `python3 -m http.server 8765 --bind 127.0.0.1`, then run `CI=true npm run test:browser` after `npm ci` and `npx playwright install chromium`. For additional engine coverage, install the Firefox and WebKit Playwright browsers and run `npm run test:compat`. Localhost is a secure context for camera APIs; production requires HTTPS. Chromium CI smoke tests exercise the real LVGL screen, pointer input, restart, SD import/export and Specter platform read/write, synthetic QR through Specter's `QRHost`, fake-webcam camera capture, Smartcard APDU/PIN/slot behavior, and the legacy route.

## Caddy

`vps-config/Caddyfile` sets these headers for the browser pages, including `/simulators/` and its embedded device:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

It serves versioned artifacts with immutable caching and `browser/current.json` plus `build-info.json` with revalidation. It retains `/api/*`, VNC WebSocket paths, `/novnc/*`, and restart routes solely for the legacy page. Caddy should serve the `.wasm` file with `application/wasm` and compress static assets using zstd/gzip. Check the live response headers with `curl -I https://try.clavastack.com/` and `curl -I https://try.clavastack.com/builds/.../micropython.wasm`.

## Publish

Build and test first. Copy `index.html`, `browser/`, `simulators/`, `assets/`, `legacy/`, and all three generated versioned build directories to `/var/www/try-clavastack` on the VPS. Keep existing site routes such as `/specter3-testing/`. Stage the Caddyfile separately, validate it using `caddy validate --config /etc/caddy/Caddyfile`, then reload Caddy. Check both normal pages, SD import and transfer, camera permission, `/legacy/`, and `/simulators/legacy/` in a real browser. Publish artifact directories before the `browser/current.json` and `browser/variants/*.json` pointers.

The normal browser page fetches only `/browser/current.json`, its versioned build manifest/assets, the Worker, local logos/mockup, and the bundled QR decoder. It must not call `/api/allocate`, `/api/heartbeat`, `/novnc/*`, or a VNC WebSocket. `?legacy=1` redirects to `/legacy/`, which still uses those services and its old restart API. [The previous VNC deployment instructions](legacy/SETUP-VNC.md) remain available for rollback.

## State and security

The Worker runs Specter with no network socket module and an in-memory `/state` filesystem. Browser SD content is at `/state/sd`, the existing simulator path for Specter's `/sd` platform abstraction. Normal restart snapshots `/state/flash`, `/state/qspi`, `/state/sd`, and `/state/cards` in page memory; factory reset retains SD and card files. Reset card wipes a selected card separately. Reloading or closing the page clears all simulation data. Files, seed material, QR contents, card data, and webcam frames are never uploaded. **Never use a real seed phrase.**

When DIY Specter activates its scanner trigger, the device screen switches to a camera view and the browser asks for camera permission. A lower backup preview can be toggled independently, with device selection where available. Camera tracks stop when no view needs them or the page closes. Decoded QR bytes enter DIY Specter's scanner UART only during an active scan. The white MemoryCard tray has three isolated slots and passes APDUs to `browser/runtime/uscard.py`, which emulates the upstream applet's select, ephemeral-static secure channel, PIN and secret-storage commands. A click inserts/removes a card; right-clicking confirms a reset. `/simulators/` runs DIY and the two distinct Playground MockUI applications at once. Drag the shared SD or MemoryCard from its tray onto a device, or from one device to another. The parent snapshots that peripheral's files from the source Worker, removes them there, imports them into the destination Worker, and activates its virtual transport. Each device's flash remains separate, including MockUI's `/flash` preferences across restart. The Playground UI prototypes contain demo state and do not implement DIY's wallet SD, QR or Smartcard protocols; transferred media bytes remain available in their browser runtime but those MockUI screens may not consume them. The SD artwork is stored locally under `assets/` and comes from Wikimedia Commons under CC0. The transport has no hardware security. USB, battery and other JavaCard applets remain unavailable.

After the browser build has sustained production validation across target browsers, the dedicated Specter slot services, Xvfb, x11vnc, noVNC, websockify, allocator, heartbeat, restart API, and their Caddy proxy routes can be retired. Until then, keep them for `/legacy/`.
