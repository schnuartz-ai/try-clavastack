# Shared companion media

`browser/companion-media.js` owns the existing compact UI, drag/drop and tap insertion, SD file import/export, capacity checks, persistence, media ownership, and demo import. Its stylesheet is `browser/companion-media.css`. Specter Desktop, Bitcoin Keeper, Bull Bitcoin and BlueWallet mount it directly; the Sparrow workbench embeds Specter Desktop and consequently uses the same module. Future companion pages should mount this component instead of copying its HTML or event handlers.

The original standalone DIY layout remains in `index.html`. Both it and companion workbenches call the same `createDemoImporter` in `browser/demo-import.js`, which lazily loads `browser/demo-data.js`. Testnet/Mainnet selections create the identical SD file set and prepare empty Ghost/Zoo MemoryCards with their existing public PINs. No MemoryCard is automatically inserted. None removes only the demo file names and cards prepared by that importer session. Occupied cards are preserved.

## Adapter contract

```js
import { createCompanionMedia } from '/browser/companion-media.js';
const media = createCompanionMedia({
  container: document.querySelector('#companion-media'),
  companionLabel: 'Bitcoin Keeper',
  storageKey: 'clavastack-keeper-removable-media-v1',
  isDiyRunning: () => firmwareReady,
  isCompanionReady: () => companionReady,
  sendDiyMessage: message => diyFrame.contentWindow.postMessage(message, location.origin),
  getTargetZone: target => target === 'desktop' ? companionDropZone : diyDropZone,
  onState: state => notifyCompanion(state),
});
await media.init();
```

Include the shared stylesheet, the SD/DIY drop-zone hitboxes with `data-media-target="desktop"` / `"diy"`, and the normal embedded DIY iframe (`/?embedded=1&gallery=1&variant=diy&qr-bridge=1`). The internal owner `desktop` means the mounted companion, regardless of its display name. Each app supplies its own storage key. Specter retains its pre-existing database and ownership keys.

Forward same-origin messages only after checking `event.source === diyFrame.contentWindow`. `media.handleDiyMessage(data)` consumes `child-awaiting-peripherals`, `peripherals-snapshot` and `peripheral-state`. Call `media.render()` after readiness/restart changes. The shared component imports through native firmware commands and requests ordered snapshots to preserve binary file bytes and genuine card identities.

`media.handleCompanionMessage(data, reply)` supports the existing `specter-media-*` protocol: state request/bridge-ready, list and write. These protocol names remain stable for existing Desktop adapters. `reply(message)` must target the original requesting same-origin companion frame. The app connects native file import/export dialogs to this protocol rather than using a second filesystem.

The Cable Connection UI is shared. The app connects `#cable-toggle` to its supported real transport. For Specter this is upstream HWI serial commands and the running DIY USB host. Keep the checkbox clickable while the firmware's USB setting is disabled; distinguish an armed cable from an operational connection through status and accessible labels. Do not claim a working cable without the app-specific transport tests.

`browser/companion-workbench.js` supplies the common readiness, reset and direct QR transport for Keeper and Bull. Each page passes its runtime message prefix (`id`), display `label` and media `storageKey` to `createCompanionWorkbench`. The app announces actual runtime/app readiness and current QR/scanner state through its own platform boundary. Animated frames stay buffered across repeated cycles, and sending pauses while Specter's native UART scanner restarts between fragments. This transport does not interpret wallet data.

## Bitcoin Keeper adapter

Keeper uses `clavastack-keeper-removable-media-v1`, independently of Desktop's media store. Its original document picker and sharing boundaries use `browser/companion-file-dialog.js` for computer upload/download or the currently inserted SD card. Temporary RNFS handles only hold files while an upstream operation reads or exports them; the shared component remains the sole SD filesystem. `src/services/fs` maps to a web adapter because the upstream OS service handles only Android and iOS. The upstream screens and PSBT validation remain unchanged.

The pinned Keeper Specter integration supports QR signing. The cable box therefore reports unavailable USB transport and never shows an operational connection. QR frames still enter each application's normal scanner/parser boundary. The None importer removes only cards prepared during its current session; after reloading, existing occupied cards are preserved.

## Bull Bitcoin adapter

Bull mounts the same workbench with `id: 'bull'` and `storageKey: 'clavastack-bull-bitcoin-removable-media-v1'`. Original Flutter file import/export dialogs use the same `companion-file-dialog.js` client as Keeper; Bull's temporary filesystem is separate from removable media. Native Dart QR/UR readers receive frames from the platform camera/direct-QR adapter, while original BDK/LWK libraries retain wallet derivation, transaction validation and signing. The cable box reports unavailable USB transport. See [the Bull build and runtime documentation](bull-bitcoin-browser.md) for its pinned sources and browser boundaries.

## Verification

- `node browser/test-demo-data.mjs`: public fixtures and binary card payloads.
- `node browser/test-demo-import.mjs`: original standalone layout, worker/canvas continuity and import behavior.
- `node browser/test-desktop-sd-capacity.mjs`: shared 8 GB checks, atomic reads, picker/drop/paste paths.
- `node browser/test-companion-media.mjs`: actual Spectrum Testnet startup/reset, SD/card byte parity, identity protection, switching/None, round trip, compact desktop/mobile layout and cable toggle.
- `node browser/test-specter-workflows.mjs`: native upstream wallet, USB, SD, QR and signing workflows.
- `node browser/test-keeper-media.mjs`: actual Keeper onboarding, shared media parity, persistence, firmware SD deletion, original Keeper file screen import/export, browser picker/download and responsive layout.
- `npm run test:bull`: original Flutter onboarding, native BDK/LWK checks, wallet reload, unchanged BIP329 SD import/export, saved network choice, isolated reset, animated QR signing through actual Specter firmware, watch-only import and HTTP transport errors.

Change shared behavior once, then run these checks and each affected companion's existing workflow suite. Shared changes ship with the same static release, so root DIY, embedded DIY and companion UIs receive them together.

BlueWallet passes `allowedDemoNetworks: ['testnet']` to the shared workbench. The importer enforces this policy before any mutation, as well as limiting the visible selector. Its media store is isolated from the other companions. `npm run test:bluewallet` covers its original file menus and actual Specter QR signing roundtrip; `browser/test-bluewallet-package.mjs` verifies the production archive.
