# Specter Desktop browser audit

The browser runs the pinned upstream Specter Desktop Flask app, the upstream
Spectrum extension and Spectrum wallet database. The DIY runs frozen upstream
MicroPython firmware. Wallet databases and descriptors remain in browser storage.
The VPS adapter relays allowlisted Electrum TLS requests and does not store wallets.

## Repeatable tests

- `python -m unittest discover -s pool -p test_electrum_relay.py`: destination and
  method validation, status hashes, batches, response ordering, read retries and
  no automatic retry for transaction broadcast.
- `node browser/test-specter-desktop.mjs`: real Flask routes, QR/animated UR,
  shared virtual SD, cable controls, reload and reset.
- `node browser/test-specter-workflows.mjs`: actual Blockstream TLS connection,
  real DIY USBHost/XpubApp keys, device creation, single signature wallet,
  independently derived receive addresses, settings, wallet/ZIP backups,
  fee JSON, native shadow-root SD picker, signed synthetic PSBT import and
  finalization, persistence and startup during a relay outage.
- `node browser/test-desktop-public-secp.mjs`: 32 independent BIP32 derivations,
  original Python point arithmetic, invalid points/tweaks and infinity. Only
  public point operations use the pinned tiny-secp256k1 2.2.4 WASM adapter; its
  JavaScript and WASM assets are checked against their build SHA-256 hashes.
  Bundles have content-addressed directories, including their dependencies,
  so a changed bundle cannot reuse an older archive URL for the same commit.
- `node browser/test-specter-history.mjs`: read-only mainnet synchronisation of
  the public BIP39 test wallet, including actual historical transactions.
- `node browser/test-specter-csrf.mjs`: import four public keys and save a device
  on the live HTTPS site in a disposable browser context.
- `node browser/test-simulators.mjs`: the shared gallery SD/MemoryCard behavior,
  drag/drop, paste, card identity, restart and reset.

Start `python browser/serve-local.py` for HTTP. For the HTTPS CSRF regression,
run `browser/test-isolated-server.py --port 8767 --cert CERT --key KEY` with a
local test certificate, then set `TEST_BASE_URL=https://127.0.0.1:8767`.
Only this disposable browser test disables validation of that local certificate.
The live Electrum adapter always validates upstream TLS certificates.

Test fixtures use the public BIP39 `abandon ... about` mnemonic, with the public
passphrase `ClavaStack public browser audit`. No real funds or private user seeds
are used. Opening the Send page is not proof of signing or broadcasting a payment.
The history audit uses the same public mnemonic without a passphrase, solely
to inspect its existing public transactions; it never broadcasts a transaction.

## VPS adapter update

Stage `pool/ab_api.py`, `pool/electrum_relay.py` and
`deploy/install-electrum-relay.sh` in a separate directory on the existing VPS.
Run that installer as root. It updates the existing `try-ab-builder.service`,
checks the actual Blockstream handshake and rolls back the API files on failure.
The existing `/api/ab/*` proxy uses port 9002 on loopback; no additional public
port is opened. This installation is separate from the static site release.

## Observed results, 2026-10-03

- Live HTTPS device creation: four keys imported, Continue saved the device.
- Public mainnet history: 25 visible actual transactions; wallet creation and
  history took 72.3 seconds, with the table appearing 1.6 seconds after creation.
- VPS TLS relay: actual Blockstream Electrs 0.4.1 / Electrum protocol 1.4 handshake
  through the public API after installation. Existing API RSS: 23,012 KiB versus
  16,120 KiB before; these are idle measurements, not a peak-load guarantee.
- SD capacity, atomic file import, shared SD snapshots and gallery SD/MemoryCard
  drag/drop, restart and reset checks passed.
- Manual normal-firmware SD signing: a PSBT with a fictional input was read,
  signed and saved back to SD. Its single signature was independently verified
  with bitcoinjs-lib and tiny-secp256k1; input/output/fee amounts matched.
  Desktop imported that same signed file using the upstream file-uploader and
  Spectrum finalized it as ready to send, with the original 1,000 sat fee.
  No transaction was broadcast. The regression test records broadcast RPC calls
  and asserts that none were sent.

The history cache adapter fixes the upstream category cache-key mismatch and
preserves cached zero amounts and False ownership values. Calculations for new
transactions still use the original upstream code.
