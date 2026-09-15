# Mobile startup repair — 2026-09-15

## Proven defects and remaining uncertainty

The website handled `worker-error` with immediate terminal failure, bypassing its
OffscreenCanvas recovery. Native `worker.onerror` and WASM abort used a different
path. Recovery terminated a worker but did not immediately invalidate its run
generation; duplicate/late events and unguarded delayed starts could race with a
replacement worker. The fork had no generation protection and its Technical
details anchor had no matching HTML ID.

These defects are fixed. They explain missing recovery and inadequate diagnostics,
but **do not prove the original reason that either physical Android device
crashed**. No physical Android/iOS device or ADB connection was available. An OS
process kill may provide no JavaScript exception or stack. Memory exhaustion was
fault-injected, not reproduced under an actual Android memory limit.

## Behavior

- One OffscreenCanvas worker attempt, then at most one fresh Canvas-Pixelbridge
  attempt for DIY. A browser without canvas transfer starts directly in the bridge.
- Worker errors, aborts, deserialization failures, transfer exceptions and startup
  timeouts use the same bounded path. Manual Retry/Restart starts a fresh sequence.
- A failed generation is invalidated before retry scheduling. Old callbacks and
  old startup timers cannot stop the replacement worker.
- Each startup attempt has a 60-second limit (at most about 120 seconds when both
  attempts stall). Slow downloads are not claimed to have no timeout.
- The error headline includes the class and cause; full URLs/stacks stay in
  Technical details. The page logs phase, display, firmware commit, artifact
  version, worker revision, device capabilities and actual asset HTTP responses.
- `micropython.js` has a HEAD diagnostic before classic `importScripts`; WASM/data
  requests are observed without buffering duplicate WASM responses. Emscripten's
  existing ArrayBuffer compilation fallback handles a non-WASM MIME type.
- Worker revision `2026-09-15.1` is included separately from artifact version in
  the worker URL. Firmware remains commit `89431c644cc300c55b53220d262a31be02353969`,
  artifact version `6bccae8bafb71a59`. No generated firmware artifacts were edited.
- Specter Python, LVGL, local peripherals and the existing legacy route remain in
  use. No telemetry upload or new seed/QR/SD network transport was introduced.

## Validation

- `node --check browser/site.js`, `node --check browser/runtime-worker.js` and
  `git diff --check`: pass.
- `npm run test:browser` against localhost: pass, including desktop/mobile touch,
  restart, SD import/export and firmware reads/writes, QR/animated UR, synthetic
  webcam, Smartcard, both Playground variants and three simultaneous simulators.
- `node browser/test-startup.mjs`: 14 scenarios pass on Chrome and Brave desktop
  with Android Pixel 5 UA, 360x740 viewport, DPR 3 and touch. Includes OffscreenCanvas,
  bridge, worker-error, abort, messageerror, RuntimeError/rejection stack, transfer
  DataCloneError, missing JS/WASM/data, wrong MIME, native worker load failure,
  manual restart, stale callbacks/timer, simulated allocation failure and network
  throttling (150 ms, 750 kB/s) with 4x CPU slowdown.
- Existing mobile tests also exercise DPR 2. The low-memory test checks bounded
  error handling; it is not a measurement of mobile memory requirements.
- `node browser/test-compat.mjs`: Firefox and WebKit DIY boot/display/pointer/
  restart/SD pass. Firefox Playground variants pass. WebKit Playground uses its
  existing explicit legacy fallback. These are desktop engine tests, not Firefox
  Android or Safari iOS certification.
- Fork `web/tests/test-site.mjs` and its 14 startup scenarios: pass, served from
  `web` on port 8766. Fork retains its existing 64M Python heap; production retains
  its existing 16M heap.
- Public `TEST_BASE_URL=https://try.clavastack.com node browser/test-site.mjs`:
  pass, including `crossOriginIsolated=true` and no browser-mode VNC requests.
- Public `node browser/test-startup.mjs`: all 14 scenarios pass, including stale
  worker callbacks and an explicitly fired timeout from the old generation.

The first local run hit another server already bound to port 8765. Subsequent
website runs used 8875. Ignored local build artifacts were also stale relative to
tracked build pointers; the deployed artifacts were downloaded before retesting.
The first public fault-injection run lacked COEP headers on a synthetic worker
response; test fixtures now preserve the isolation policy required on production.

## Deployment

Website implementation commit: `76361bb`. Fork implementation commit: `ed31285`.
Production updated on 2026-09-15 at about 14:32 UTC.

Backup: `/var/backups/try-clavastack/mobile-startup-20260915-1/` contains the previous
index, site script, worker and Caddyfile. Caddy validation passed before replacement.
Caddy configuration did not change and did not require reload.

Live index/site/worker bytes were compared with local files and matched exactly.
All three return HTTP 200, appropriate HTML/JavaScript MIME types, `no-cache`, and
the COOP/COEP/CORP headers. Live WASM returns `application/wasm`.

Rollback: restore those three backed-up files to their respective production
paths. Restore Caddyfile only if it has subsequently been changed, validating it
before a reload.

## Physical-device follow-up

Reload https://try.clavastack.com on the affected phone. If startup still fails,
use Technical details to retrieve the error/stack and preceding startup markers.
Worker/device/asset diagnostics are displayed locally and are not uploaded.
Physical Android acceptance remains open until that test is reported.
