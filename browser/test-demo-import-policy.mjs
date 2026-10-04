import { strict as assert } from 'node:assert';
import { createDemoImporter } from './demo-import.js';
import { createDemoFiles } from './demo-data.js';

const occupied = createDemoFiles('testnet').cards[1];
const key = new Uint8Array(32).fill(7);
const files = new Map([
  ['cards/1/private.key', key], ['cards/1/secret.bin', occupied.secret],
  ['cards/1/pin.bin', occupied.pinDigest], ['sd/user.bin', new Uint8Array([0, 255])],
]);
let sdOwner = null;
let activeCard = null;
const sent = [];
const adapter = {
  isRunning: () => true, capacity: 8_000_000_000,
  getSdOwner: () => sdOwner, setSdOwner: async owner => { sdOwner = owner; },
  getActiveCard: () => activeCard,
  snapshot: async () => [...files].map(([path, bytes]) => ({ path, bytes })),
  send: command => {
    sent.push(command.type);
    if (command.type === 'sd-import') files.set(`sd/${command.name}`, command.bytes);
    if (command.type === 'sd-delete') files.delete(`sd/${command.name}`);
    if (command.type === 'state-import') for (const file of command.files) files.set(file.path, file.bytes);
    if (command.type === 'card-create') files.set(`cards/${command.slot}/private.key`, new Uint8Array(32).fill(command.slot));
    if (command.type === 'card-reset') for (const path of [...files.keys()]) {
      if (path.startsWith(`cards/${command.slot}/`) && !path.endsWith('/private.key')) files.delete(path);
    }
    if (command.type === 'card-remove') activeCard = null;
    if (command.type === 'card-insert') activeCard = command.slot;
  },
};
const importer = createDemoImporter(adapter);
await importer.apply('testnet');
assert.deepEqual(files.get('cards/1/private.key'), key);
assert.deepEqual(files.get('cards/1/secret.bin'), occupied.secret);
assert(!importer.metadata.has(1));
assert(importer.metadata.has(2));
assert(!sent.includes('card-insert'));
await importer.apply('mainnet');
assert.deepEqual(files.get('cards/1/secret.bin'), occupied.secret);
await importer.apply('');
assert.deepEqual(files.get('cards/1/private.key'), key);
assert.deepEqual(files.get('cards/1/secret.bin'), occupied.secret);
assert.deepEqual(files.get('sd/user.bin'), new Uint8Array([0, 255]));
assert(!files.has('cards/2/secret.bin'));
assert.equal(sdOwner, null);
const limited = createDemoImporter({ ...adapter, capacity: 1 });
const before = sent.length;
await assert.rejects(limited.apply('testnet'), /full/);
assert.equal(sent.length, before, 'Capacity preflight partially mutated media');
assert.equal(sdOwner, null);
const restricted=createDemoImporter({...adapter,allowedNetworks:['testnet']});
const beforePolicy=sent.length;await assert.rejects(restricted.apply('mainnet'), /only accepts testnet/);assert.equal(sent.length,beforePolicy);
console.log('PASS shared demo policy preserves pre-existing occupied cards and ordinary files, capacity preflight is atomic');
