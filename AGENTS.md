# ClavaStack companion applications

When adding or changing a companion app beside Specter DIY:

- Use `browser/companion-media.js` and `browser/companion-media.css` for the bottom removable-media panel. Keep its three separate boxes: Virtual SD card, Virtual MemoryCards, Cable Connection. Retain the compact card spacing, responsive layout, drag/drop and tap-to-insert behavior, file picker/drop/paste, downloads, refresh, clear, and card reset.
- Use `browser/demo-import.js` for the None / Testnet Demos/Seed / Mainnet/Demos Seed import. `browser/demo-data.js` is the only demo dataset. Standalone DIY uses the same importer with its own layout. Do not duplicate the importer or introduce different sample seeds, PINs, card payloads or file sets.
- Import into the actual running firmware and the companion's virtual media store. A card must keep its firmware-generated identity and files as it moves or restarts. Never overwrite an occupied Smartcard or insert it automatically. Preserve unrelated SD files when replacing/removing demo sets.
- Keep wallet and firmware operations in the real upstream application. Shared UI adapters expose transport and virtual peripherals; they must not replace wallet derivation, parsing or signing.
- Default a new/reset Bitcoin companion session to its supported Bitcoin test network. Specter Desktop uses Bitcoin Testnet (Testnet3). Preserve explicitly saved network selections and keep networks distinct in storage and transport.
- Implement app-specific runtime/QR/USB/network hooks through the shared component adapter contract in `docs/companion-media.md`. Update shared modules for common behavior, so existing companion apps receive that change automatically.
- Verify the common panel with `browser/test-companion-media.mjs`, standalone import parity with `browser/test-demo-import.mjs`, and each companion's upstream workflow tests. Use only public demo data and synthetic transactions.

Gmail: never write, send, forward or delete email. Other Gmail operations are allowed.
