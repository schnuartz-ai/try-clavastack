# Try Specter DIY in your browser

[try.clavastack.com](https://try.clavastack.com) runs the **real Specter DIY Python application and LVGL UI** in a WebAssembly MicroPython Unix simulator. [All Simulators](https://try.clavastack.com/simulators/) runs that wallet beside the **distinct original LVGL 9 MockUI scenarios** from k9ert's and Schnuartz's Playground repositories, with the fast Marco fork available from the Playground switch. These Playgrounds are source-code UI prototypes with demo wallet state, just as on the former VNC page; they are not copies of the DIY wallet. Production serves static files only and runs no remote Specter, VNC or allocator processes.

**NEVER ENTER A REAL SEED PHRASE.** This is an internet-connected browser simulator, not a hardware wallet or an air-gapped device. Use test seeds only.

```text
Browser page: device frame, SD/Card tray, webcam, jsQR
    │ pointer / files / decoded QR bytes
    ▼
Web Worker: Emscripten MEMFS + MicroPython Unix/WebAssembly
    │ actual pinned Specter Python, matching LVGL, hardware shims
    ▼
SDL software renderer → OffscreenCanvas → device screen cutout
                         or LVGL framebuffer → Worker pixel bridge → Canvas
```

The source build follows the latest `master` commit of the official [`cryptoadvance/specter-diy`](https://github.com/cryptoadvance/specter-diy), using Emscripten 3.1.74. Version-addressed assets live under `builds/cryptoadvance/specter-diy/<commit>/`. [`browser/current.json`](browser/current.json) selects the latest tested production build and appends an artifact-hash query to immutable asset URLs; each generated `build-info.json` records source, toolchain, timestamp, artifact sizes, and SHA256 hashes. Assets are built from source and ignored by Git, then published with the static site. Set `SPECTER_SOURCE_SHA` for a reproducible historical build.

## Build and test

Use Linux or WSL2 with `git`, `make`, Python 3.11+, Node 22+, and Emscripten 3.1.74:

```bash
git clone https://github.com/emscripten-core/emsdk.git .browser-work/emsdk
.browser-work/emsdk/emsdk install 3.1.74
.browser-work/emsdk/emsdk activate 3.1.74
bash browser/build-browser.sh
bash browser/build-playground.sh k9ert
bash browser/build-playground.sh play-fast
bash browser/build-playground.sh schnuartz
python3 browser/verify-build.py
npm ci
npx playwright install chromium
python3 -m http.server 8765 --bind 127.0.0.1 &
CI=true npm run test:browser
# Optional Firefox/WebKit smoke test after installing those Playwright browsers:
npx playwright install firefox webkit
npm run test:compat
```

The DIY build checks out its pinned source, applies narrow **build-time** WebAssembly compatibility patches, freezes Specter's `src/` tree, and compiles LVGL/SDL with the Unix simulator. [`browser/patch-source.py`](browser/patch-source.py) handles older C callbacks, GC stack scanning, and SDL presentation/input at the platform boundary. The two Playground builds instead compile each fork's own MicroPython/LVGL 9 C tree and freeze its own `scenarios/MockUI/src` package. [`browser/prepare-mockui.py`](browser/prepare-mockui.py) stages the original scenario entry point with only the browser flash mount and readiness marker adapted; wallet/UI logic remains in the fork. [`browser/v9-patches/`](browser/v9-patches/) contains the reproducible C compatibility patches. Source paths and Emscripten glue are normalized. Each build manifest records the exact source commit and artifact hashes.

The CI workflow at [`.github/workflows/browser.yml`](.github/workflows/browser.yml) builds on a fresh runner, verifies asset hashes, runs Specter's native tests, serves static files, and runs Playwright smoke tests. Those tests cross the browser → Worker → firmware boundary for rendering, pointer input, SD read/write through `platform.SDCard`, text plus two-frame UR/PSBT QR decoded by Specter's `QRHost`, and the real `MemoryCardApplet` APDU/secure-channel/PIN flow. A deterministic fake webcam tests capture through decoding into `QRHost` without camera hardware in CI.

## Peripherals and storage

- **Display and touch:** LVGL renders 480 × 800 firmware pixels. Browsers with transferable OffscreenCanvas use SDL software rendering in the Worker. The DIY build can also send dirty LVGL pixels to a normal Canvas in WebKit without OffscreenCanvas; the Playground LVGL 9 builds require transferable OffscreenCanvas and offer a legacy link otherwise. Pointer coordinates are scaled into the native resolution and enter the existing SDL/LVGL mouse driver. The page does not reproduce wallet controls in HTML.
- **SD:** Emscripten MEMFS is session-only. The card occupies the simulator's existing `config.storage_root + '/sd'` path, which is `/state/sd` in the browser build. Insert/eject changes `platform.SDCard.is_present`; arbitrary imported files and firmware-written files can be listed, downloaded, or deleted. Normal restart keeps simulated flash and SD files in tab memory. Factory reset wipes flash while retaining the card; Clear card and Eject act separately. Reloading the page discards all simulated state.
- **Camera and QR:** Specter's scanner trigger pin activates the camera view inside the device screen and requests `getUserMedia()` access. A separate lower preview can be enabled or hidden and its camera selected. Bundled jsQR 1.4.0 decodes frames only while Specter scans; its `binaryData` bytes enter the same `pyb.UART('YA')` decoded-scanner seam that Specter's `QRHost` uses. Specter itself parses text, wallet payloads and animated formats. QR output remains LVGL-generated. Camera frames and QR payloads are never sent to the server.
- **Smartcards:** The browser implements this fork's MemoryCard APDU transport at `uscard.Reader`, following the [upstream Specter-JavaCard protocol](https://github.com/cryptoadvance/specter-javacard). It provides three isolated, session-only slots; one card can be inserted at a time. Card identity, PIN hash, attempt count and secret data belong to the slot and survive a normal firmware restart. Reset card creates a new identity and wipes that slot. The real Specter `MemoryCardApplet` opens its secure channel, sets and checks PINs, and reads/writes secrets in CI. This is a software simulation with none of a physical smartcard's protection. Other JavaCard applets such as BlindOracle are not emulated or advertised.

The MicroPython build disables sockets, SSL, and threads for the wallet runtime. The browser shell fetches only static build files; it makes no telemetry or data-upload requests. HTTPS is required for camera access. [`vps-config/Caddyfile`](vps-config/Caddyfile) sets COOP, COEP and CORP headers, compresses static responses, caches immutable versioned WASM assets, and keeps build manifests fresh.

The expandable **Virtual USB Connection** section offers **Specter Virtual
Host** downloads for Windows, Linux x64, macOS Intel and macOS Apple Silicon.
The buttons point to the pinned, checksummed `v1.0.4` release assets in the
standalone [`cryptoadvance/specter-virtual-host`](https://github.com/cryptoadvance/specter-virtual-host/releases/tag/v1.0.4)
repository, so the website does not have to host executable files itself. This
small local program reverse-proxies the simulator onto
`127.0.0.1:8788` and exposes Specter DIY's established simulator transport on
`127.0.0.1:8789`, which Specter Desktop detects as a Specter DIY device. Browser
USB bytes remain local and traverse the real firmware `USBHost`; the bridge does
not emulate wallet responses. Its canonical source and cross-platform release
workflow live in the standalone
[`cryptoadvance/specter-virtual-host`](https://github.com/cryptoadvance/specter-virtual-host)
repository; the local `virtual-host/` copy is retained only for the website's
integration test.
The simulated device must first complete wallet setup with public test data and
reach its Applications screen; an uninitialized device cannot return the
fingerprint Specter Desktop requests during discovery.

`/simulators/` runs three Workers concurrently, one per device, with separate simulated flash. A shared workbench holds one 8 GB SD card and three MemoryCards. Drag a card onto a device to insert it, drag it onto another device to transfer its bytes, or click an inserted card to eject it. On transfer, the parent snapshots the source Worker, removes the media files there, imports the exact bytes into the destination Worker, then activates its virtual transport. The card and SD contents remain in tab memory; reloading clears them. The Worker enforces the SD card's 8,000,000,000-byte capacity for browser imports and firmware filesystem writes. The main page uses a click to insert/remove and right-click with confirmation to reset each MemoryCard. The SD artwork is the 8 GB image at `assets/sd-card-8gb.png`. Each build has its own versioned artifact directory and source manifest. DIY consumes SD files and Smartcard APDUs through its real wallet platform. The Playground MockUI scenarios use stub device state, so their menus do not implement every wallet operation or consume all transferred media files. Their original, distinct screens are rendered by their own Python/LVGL 9 code. The gallery places each device image outside its iframe and embeds only the live firmware screen in its cutout, avoiding a rectangular iframe background. Its feedback form drafts a GitHub issue with the selected device and source commit; text stays in the tab until the visitor chooses to continue and submit on GitHub.

## Deployment and rollback

See [`SETUP.md`](SETUP.md) for the complete deployment design. Every successful
`main` build publishes a checksummed, commit-labelled production package on
GitHub. The VPS pulls that package as an unprivileged deployment user, verifies
it, and atomically changes a `current` symlink. Previous releases remain
available for immediate rollback; no source files are copied manually into the
live webroot. Caddy imports the public site from an isolated site file; the
A/B page's separate on-demand builder runs as an unprivileged service and
accepts approved public Specter source links. A future Tailscale-only CRM can
be configured separately without exposing it on the public hostname. The
previous VNC setup guide is archived at
[`legacy/SETUP-VNC.md`](legacy/SETUP-VNC.md).

Current browser support is aimed at current Chromium and Firefox versions with WebAssembly, Web Workers, and transferable OffscreenCanvas. The DIY build also has a Canvas pixel bridge for WebKit without OffscreenCanvas. The LVGL 9 Playground builds currently require transferable OffscreenCanvas. Camera access additionally requires HTTPS and permission. CI exercises Chromium; local Playwright smoke tests cover Firefox and the WebKit DIY/fallback path. Physical USB enumeration, physical QR scanner settings, battery measurements, hardware RNG/security guarantees, and non-MemoryCard JavaCard applets are not emulated. The optional Virtual Host exposes only the simulator's documented USB protocol to software on the same PC.

## Phase 2 TODO

CI builds the latest Specter `master` source on pushes, pull requests, and the
scheduled update run. The versioned build directory and manifest keep each
resolved commit addressable, while `SPECTER_SOURCE_SHA` remains available for
reproducible historical builds. Successful `main` runs are published and pulled
into production automatically.
