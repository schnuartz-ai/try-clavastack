// One import policy for the standalone firmware and every companion workbench.
// Commands go to the real running firmware; card identities are created there.
export function createDemoImporter(adapter) {
  const metadata = new Map();
  const resetSlots = new Set();
  let active = false;
  let insertedSd = false;
  let previousCard = null;
  const snapshot = adapter.snapshot;
  const send = adapter.send;
  return {
    metadata,
    resetCard(slot) { metadata.delete(slot); resetSlots.delete(slot); },
    async apply(network) {
      if (network && adapter.allowedNetworks && !adapter.allowedNetworks.includes(network)) throw new Error(`This companion only accepts ${adapter.allowedNetworks.join(", ")} demo data.`);
      if (!adapter.isRunning()) throw new Error('Specter DIY is still starting.');
      if (!network && !active) return;
      const { createDemoFiles } = await import('./demo-data.js?v=20260930-mainnet-bip84-psbt-v3');
      const testnet = createDemoFiles('testnet');
      const mainnet = createDemoFiles('mainnet');
      const names = new Set([...testnet.files, ...mainnet.files].map(file => file.name).concat([
        'mainnet-multisig-unsigned.psbt', 'mainnet-ghost-zoo-mirror-2of3.json',
      ]));
      let files = await snapshot();
      const previous = files.filter(file => file.path.startsWith('sd/') && names.has(file.path.slice(3)));
      if (!network) {
        for (const file of previous) send({ type: 'sd-delete', name: file.path.slice(3) });
        for (const slot of resetSlots) send({ type: 'card-reset', slot });
        resetSlots.clear();
        metadata.clear();
        if (adapter.getActiveCard() !== previousCard) {
          send({ type: 'card-remove' });
          if (previousCard !== null) send({ type: 'card-insert', slot: previousCard });
        }
        if (insertedSd && adapter.getSdOwner() === 'diy') await adapter.setSdOwner(null);
        await snapshot();
        insertedSd = false;
        active = false;
        previousCard = null;
        return;
      }
      const demo = network === 'testnet' ? testnet : network === 'mainnet' ? mainnet : null;
      if (!demo) throw new Error(`Unsupported demo network: ${network}`);
      const used = files.filter(file => file.path.startsWith('sd/')).reduce((sum, file) => sum + file.bytes.byteLength, 0);
      const replaced = previous.reduce((sum, file) => sum + file.bytes.byteLength, 0);
      const added = demo.files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
      if (used - replaced + added > adapter.capacity) throw new Error('Virtual SD card is full');
      if (!active) { previousCard = adapter.getActiveCard(); active = true; }
      if (!adapter.getSdOwner()) { await adapter.setSdOwner('diy'); insertedSd = true; }
      for (const file of previous) send({ type: 'sd-delete', name: file.path.slice(3) });
      for (const file of demo.files) send({ type: 'sd-import', name: file.name, bytes: file.bytes });
      files = await snapshot();
      for (const slot of [1, 2]) {
        if (files.some(file => file.path === `cards/${slot}/private.key`)) continue;
        send({ type: 'card-create', slot });
        files = await snapshot();
      }
      for (const card of demo.cards) {
        // Never replace an occupied card, including one prepared by a previous demo.
        if (files.some(file => file.path === `cards/${card.slot}/secret.bin` && file.bytes.byteLength)) continue;
        send({ type: 'state-import', files: [
          { path: `cards/${card.slot}/secret.bin`, bytes: card.secret },
          { path: `cards/${card.slot}/pin.bin`, bytes: card.pinDigest },
          { path: `cards/${card.slot}/attempts`, bytes: new Uint8Array([10]) },
        ] });
        resetSlots.add(card.slot);
        metadata.set(card.slot, { label: card.label, pin: card.pin, seed: `${card.id}-seed` });
      }
      await snapshot();
    },
  };
}

export function demoImportTitle(network) {
  if (network === 'mainnet') return 'Unsafe public demo seeds and private keys. Never send or store real funds. Mainnet transactions use fictional inputs. The virtual Smartcards receive the public Ghost and Zoo seeds.';
  if (network === 'testnet') return "Unsafe public test seeds only. Includes Ghost, Zoo, their BIP85 children, two single-signature PSBT examples, one unsigned Ghost + Zoo + Mirror 2-of-3 PSBT and the matching multisig wallet. Two virtual Smartcards receive Ghost (PIN 1234) and Zoo (PIN 21). Mirror's seed is never stored.";
  return 'Choose a demo set. Mainnet uses publicly known seeds; never send funds to these demo addresses.';
}
