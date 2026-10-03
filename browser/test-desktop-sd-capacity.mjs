import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../specter-desktop/site.js', import.meta.url), 'utf8');
const start = source.indexOf('async function importSdFiles(files) {');
const end = source.indexOf('\nconst sdPicker', start);
assert(start >= 0 && end > start);
const files = new Map([['sd/existing.txt', new Uint8Array(2)]]);
let reads = 0;
let writes = 0;
const context = vm.createContext({
  mediaFiles: files, mediaFor: () => [...files].map(([path, bytes]) => ({ path, bytes })),
  SD_CAPACITY_BYTES: 8_000_000_000, sdOwner: null, Uint8Array,
  persistMedia: async () => { writes++; }, reportMedia: () => {},
});
vm.runInContext(source.slice(start, end) + '\nthis.importFiles = importSdFiles', context);
await assert.rejects(context.importFiles([{ name: 'too-big', size: 8_000_000_001,
  arrayBuffer: async () => { reads++; throw new Error('Must not read'); } }]), /full/);
assert.equal(reads, 0);
assert.equal(writes, 0);
assert.equal(files.size, 1);
await assert.rejects(context.importFiles([{ name: 'first.txt', size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer },
  { name: 'failed.txt', size: 1, arrayBuffer: async () => { throw new Error('Read failed'); } }]), /Read failed/);
assert.equal(files.size, 1, 'Failed multi-file reads must not partially mutate the SD card');
await context.importFiles([{ name: 'existing.txt', size: 1, arrayBuffer: async () => new Uint8Array([9]).buffer }]);
assert.deepEqual([...files.get('sd/existing.txt')], [9]);
assert.equal(writes, 1);
for (const event of ['change', 'drop', 'paste']) {
  assert(source.includes(`addEventListener('${event}'`));
}
assert.equal((source.match(/runMediaOperation\(\(\) => importSdFiles\(files\)\)/g) || []).length, 3,
  'Picker, drop and paste must use the same capacity-checked import');
console.log('PASS Desktop SD capacity, replacement, atomic reads and all three import paths');
