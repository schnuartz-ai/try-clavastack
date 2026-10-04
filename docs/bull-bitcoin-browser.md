# Bull Bitcoin beside Specter DIY

The workbench at `/bull-bitcoin/` embeds the original Flutter application from
`SatoshiPortal/bullbitcoin-mobile`, commit
`98eb380f74a507ce1bcb6848bd2d77cf46959f9e` (6.13.1+216).
The submodule is pristine. `browser/bull/` applies a disposable platform overlay
in `.browser-work/bull-web`; it does not redraw the product or replace its BLoCs,
routes, wallet repositories, PSBT parser, native signing or derivation.

## Runtime

FVM pins Flutter 3.44.9 and Dart 3.12.2. Original generated code and dependency
versions come from the upstream lockfile. The actual BDK 3.0.0 / UniFFI and
LWK 0.18.0 Rust implementations run in WebAssembly. The browser transports their
original generated Dart APIs. BDK retains its native byte codec and checksums;
LWK retains its generated models and original Rust methods. Rust dependencies
are locked in the two checked-in Cargo lockfiles.

The overlay also corrects upstream's Testnet watch-only public-key version
normalization: it uses the existing Dart BIP32 `convert(tpub)` method before
BDK constructs the original descriptor. Public-key material and derivation
remain unchanged; BDK validates the resulting network rather than rejecting
mainnet xpub version bytes paired with Testnet metadata.

Browser adapters provide Drift/SQLite, the session filesystem, secure-storage
and preference platform interfaces, camera/direct QR, native file picking and
sharing. Original application encryption and PIN handling remain above these
boundaries. Each browser tab has its own Bull namespace. Reload preserves its
wallet; reset removes that namespace and its Drift database. Fresh sessions
start on Bitcoin Testnet3 / Liquid Testnet, and saved network choices persist.

Native BDK/LWK Esplora clients synchronize over HTTPS. Broadcasting serializes
the transaction using the original native API before sending it to the matching
Blockstream network. Responses must match the native transaction ID. Custom
Electrum/Tor TCP, USB hardware, background tasks, biometrics, Boltz and native
Payjoin OHTTP are unavailable in this browser integration. No replacement
balances, keys, signatures or successful hardware connections are fabricated.

The shared `companion-workbench.js`, `companion-media.js`,
`companion-file-dialog.js` and unchanged `demo-data.js` supply the same three
media boxes, Ghost/Zoo cards and file set as Keeper. Bull media ownership uses
`clavastack-bull-bitcoin-removable-media-v1`. QR frames enter the original
Bull QR/UR reader and Specter scanner.

## Build and acceptance

With FVM 4.3.1, Rust 1.98.1 (`wasm32-unknown-unknown`), wasm-bindgen-cli 0.2.105,
Emscripten 3.1.74 and `npm ci` installed:

```sh
python3 browser/build-bull.py --acceptance
```

The script validates pins, uses the upstream make targets on Linux, generates
the original code, applies the platform overlay, checks the full project,
verifies unchanged package versions, builds both native WASM libraries and
packages the release. The generated production artifact is ignored by Git and
included by `deploy/package-site.sh` in the tested static release.

Creating the web target preserves the original lockfile byte for byte: Flutter
3.44.9 otherwise replaces it with a partial SDK resolution even with `--no-pub`.
Preparation regression tests cover this behavior and the exact tracked case of
the upstream `makefile` before CI builds the application from scratch.
The QR decoder is bundled through esbuild's JavaScript API, which selects its
installed native binary on each operating system; CI also imports the resulting
ES module in a directory whose name contains spaces.

`acceptance.dart` is a separate test entry point, excluded from production. It
opens the original PSBT screen with the shared public synthetic fixture and
observes the original broadcast cubit's result. It neither injects wallet
balances nor replaces transaction parsing/signing. Acceptance covers native
wizard/wallet/receive/reload, BDK ABI/signatures, original Dart UR fountain frames,
LWK addresses/reopen, actual firmware QR signing, shared files and transport
errors. Synthetic transactions are never broadcast to a public network.

Bull CI uses Playwright's `chromium` channel, the regular browser running
headlessly, for every native/app/QR test. Chromium 153's separate headless shell
reproducibly segfaulted during reset on GitHub Linux runners. The retained-build
[diagnostic run](https://github.com/schnuartz-ai/try-clavastack/actions/runs/37212711864)
reproduced that failure while both regular Chromium and the shell's baseline
WASM compiler completed every reset assertion using the identical app artifact.
No app assertions are skipped and production needs no special browser flags.
The manual `Bull browser diagnostics` workflow accepts a build run ID to repeat
this comparison without rebuilding; it never publishes those retained artifacts.

## Public demo in the production application

1. Select **Testnet Demos/Seed** in the shared media panel. Initialize Specter
   through its normal PIN screen, then choose **Import recovery phrase → Open
   SD card file** and confirm `01-ghost-PUBLIC-TEST-SEED.txt`.
2. In Specter's **Settings → Switch network**, choose **Testnet**. Its network
   setting is independent of Bull's Testnet default.
3. Display **Master public keys → Single key**. In Bull's **Import Wallet →
   Specter DIY → Open camera** flow, select **Scan from Specter DIY**, give the
   wallet a label and import it. The original native wallet derives
   `tb1qvtdx75y4554ngrq6aff3xdqnvjhmct5w6luehe` for its first receive address.
4. In Specter, open `testnet-ghost-payment-low-fee.psbt` from the SD card and
   confirm its transaction review. Choose **Show as QR code → Crypto-psbt**.
   In Bull's **Broadcast signed transaction → Camera** screen, select
   **Scan from Specter DIY** to import the real firmware's signed PSBT.

The fixture's inputs are fictional. Bull's original transaction review therefore
reports that it cannot fetch that previous transaction from the network. The
demo acceptance checks the signature and unchanged outputs without broadcasting.
The production application contains no acceptance entry point or fixture wallet.
