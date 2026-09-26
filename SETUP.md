# Browser simulator setup and deployment

The simulator pages and firmware are static, and the A/B page also uses a small isolated API to resolve and build approved public Specter source links. The VPS needs HTTPS, correct WASM MIME delivery, the headers in [`vps-config/Caddyfile`](vps-config/Caddyfile), and the `try-ab-builder.service`. No interactive simulator, VNC or allocator process runs on the VPS.

## Local build

Run the commands in the [README](README.md#build-and-test) on Linux or WSL2. `browser/build-browser.sh` resolves and builds the latest `master` commit of the official `cryptoadvance/specter-diy` on every run, fetches its recursive submodules, requires Emscripten 3.1.74, and writes:

```text
browser/current.json
builds/cryptoadvance/specter-diy/<resolved-commit>/
  micropython.js
  micropython.wasm
  micropython.data
  build-info.json
```

Build the four Playground variants with `bash browser/build-playground.sh k9ert`, `bash browser/build-playground.sh play-fast`, `bash browser/build-playground.sh schnuartz`, and `bash browser/build-playground.sh schnuartz-alternative`. Unless `SOURCE_SHA_OVERRIDE` is supplied, each command resolves the current default branch before building. This compiles each fork's own LVGL 9 MockUI simulator, the same `scenarios/mockui_fw/main.py` application used by the legacy VNC services. It writes `browser/variants/*.json` and versioned artifacts under `builds/<repository>-mockui/<commit>/`. Run `python3 browser/verify-build.py` before publishing. Generated `micropython.*` files are derived from source and Git-ignored. Manifests contain SHA256 hashes; publish new assets before changing any pointer. The older `browser/build-playground-wallet.sh` is retained only for reproducing the superseded wallet-source experiment and is not used by CI or production.

Start a local static server from the repository root with `python3 -m http.server 8765 --bind 127.0.0.1`, then run `CI=true npm run test:browser` after `npm ci` and `npx playwright install chromium`. For additional engine coverage, install the Firefox and WebKit Playwright browsers and run `npm run test:compat`. Localhost is a secure context for camera APIs; production requires HTTPS. Chromium CI smoke tests exercise the real LVGL screen, pointer input, restart, SD import/export and Specter platform read/write, synthetic QR through Specter's `QRHost`, fake-webcam camera capture, Smartcard APDU/PIN/slot behavior, and the legacy route.

## Caddy

`vps-config/Caddyfile` sets these headers for the browser pages, including `/simulators/` and its embedded device:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

It serves versioned artifacts with immutable caching, `browser/current.json` plus `build-info.json` with revalidation, and routes `/api/ab/*` to the loopback-only on-demand builder. Generated A/B firmware is served from `/var/lib/try-clavastack/ab-builds` at `/ab-builds/*`. Caddy should serve the `.wasm` file with `application/wasm` and compress static assets using zstd/gzip. `/etc/caddy/Caddyfile` imports isolated site blocks from `/etc/caddy/sites-enabled/*.caddy`; this public site is installed as `try.clavastack.caddy`. A future CRM can therefore use a separate Tailscale-only listener without changing or exposing the public site. Check the live response headers with `curl -I https://try.clavastack.com/` and `curl -I https://try.clavastack.com/builds/.../micropython.wasm`.

## Publish

Production is deployed from GitHub rather than copied over SSH. A successful
`Browser simulator` run on `main` packages the complete tested site, publishes
an immutable asset on the public `production` GitHub release, and records the
source commit plus checksums. The VPS checks that release every two minutes,
downloads the newest complete asset pair, verifies both the archive and every
file inside it, and extracts it into:

```text
/var/www/try-clavastack-deploy/releases/<github-run-id>/
```

Only after verification does the deployer atomically replace the
`/var/www/try-clavastack-deploy/current` symlink. A failed download, checksum,
manifest validation, or live health check leaves or restores the previous
release. The seven newest releases are retained for rollback. Caddy serves the
`current` symlink. Old server-rendered/VNC trees are not retained.

Install the mechanism once from a trusted checkout on the VPS as root:

```bash
bash deploy/install-server.sh
```

The installer creates the deployment directories and users, validates Caddy
before changing it, installs the hardened static-deploy and A/B-builder systemd
services, and verifies the live HTTPS endpoint. The A/B builder runs as the
unprivileged `clavastack-ab` user and builds only verified Specter repositories
in an isolated work directory. The deployment service can update only its
declared webroot and state paths; GitHub release artifacts cannot modify Caddy
or private services. It uses no personal GitHub credentials.
To request an immediate check instead of waiting for the timer:

```bash
systemctl start try-browser-auto-deploy.service
```

Rollback is an atomic symlink change to a retained release followed by the same
HTTPS smoke check. Do not edit files below `releases/` in place.

The normal browser page fetches only `/browser/current.json`, its versioned build manifest/assets, the Worker, local logos/mockup, and the bundled QR decoder. `/api/*`, `/novnc/*`, VNC WebSockets and legacy server pages are not part of the production package. [The previous VNC deployment instructions](legacy/SETUP-VNC.md) remain in Git history as documentation only.

The standalone [`cryptoadvance/specter-virtual-host`](https://github.com/cryptoadvance/specter-virtual-host)
repository owns the Virtual Host source and its tagged release workflow. It
cross-compiles Windows, Linux x64, macOS Intel and macOS Apple Silicon assets,
publishes checksums, and the browser page links to the pinned release assets.
Keep the website release and Virtual Host release versions aligned when
updating the download links. The program binds only to `127.0.0.1`: port 8788
hosts the connected simulator view and browser bridge, while port 8789 is
Specter DIY's standard simulator USB endpoint for Specter Desktop.

## State and security

The Worker runs Specter with no network socket module and an in-memory `/state` filesystem. Browser SD content is at `/state/sd`, the existing simulator path for Specter's `/sd` platform abstraction. Normal restart snapshots `/state/flash`, `/state/qspi`, `/state/sd`, and `/state/cards` in page memory; factory reset retains SD and card files. Reset card wipes a selected card separately. Reloading or closing the page clears all simulation data. Files, seed material, QR contents, card data, and webcam frames are never uploaded. **Never use a real seed phrase.**

When DIY Specter activates its scanner trigger, the device screen switches to a camera view and the browser asks for camera permission. A lower backup preview can be toggled independently, with device selection where available. Camera tracks stop when no view needs them or the page closes. Decoded QR bytes enter DIY Specter's scanner UART only during an active scan. The white MemoryCard tray has three isolated slots and passes APDUs to `browser/runtime/uscard.py`, which emulates the upstream applet's select, ephemeral-static secure channel, PIN and secret-storage commands. A click inserts/removes a card; right-clicking confirms a reset. `/simulators/` runs DIY and the two distinct Playground MockUI applications at once. Drag the shared SD or MemoryCard from its tray onto a device, or from one device to another. The parent snapshots that peripheral's files from the source Worker, removes them there, imports them into the destination Worker, and activates its virtual transport. Each device's flash remains separate, including MockUI's `/flash` preferences across restart. The Playground UI prototypes contain demo state and do not implement DIY's wallet SD, QR or Smartcard protocols; transferred media bytes remain available in their browser runtime but those MockUI screens may not consume them. The SD artwork is stored locally under `assets/` and comes from Wikimedia Commons under CC0. The transport has no hardware security. USB, battery and other JavaCard applets remain unavailable.

The dedicated Specter slot services, Xvfb, x11vnc, noVNC, websockify, allocator, heartbeat, restart API and their Caddy proxy routes have been retired from production.
