# Shared companion media

`browser/companion-media.js` owns the existing compact UI, drag/drop and tap insertion, SD file import/export, capacity checks, persistence, media ownership, and demo import. Its stylesheet is `browser/companion-media.css`. Specter Desktop mounts it directly; the Sparrow workbench embeds Specter Desktop and consequently uses the same module. Future companion pages, including Bitcoin Keeper, should mount this component instead of copying its HTML or event handlers.

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

## Verification

- `node browser/test-demo-data.mjs`: public fixtures and binary card payloads.
- `node browser/test-demo-import.mjs`: original standalone layout, worker/canvas continuity and import behavior.
- `node browser/test-desktop-sd-capacity.mjs`: shared 8 GB checks, atomic reads, picker/drop/paste paths.
- `node browser/test-companion-media.mjs`: actual Spectrum Testnet startup/reset, SD/card byte parity, identity protection, switching/None, round trip, compact desktop/mobile layout and cable toggle.
- `node browser/test-specter-workflows.mjs`: native upstream wallet, USB, SD, QR and signing workflows.

Change shared behavior once, then run these checks and each affected companion's existing workflow suite. Shared changes ship with the same static release, so root DIY, embedded DIY and companion UIs receive them together.
