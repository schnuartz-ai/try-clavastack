import { createDemoFiles } from './demo-data.js';

const demo = createDemoFiles('ghost');
const decode = file => new TextDecoder().decode(file.bytes).trim();
const file = name => demo.files.find(candidate => candidate.name === name);
if (decode(file('01-ghost-PUBLIC-TEST-SEED.txt')) !== 'ghost ghost ghost ghost ghost ghost ghost ghost ghost ghost ghost machine' ||
    decode(file('01-zoo-PUBLIC-TEST-SEED.txt')) !== 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong') {
  throw new Error('Public BIP39 vectors changed');
}
for (const name of ['02-ghost-bip85-child-0.txt', '02-ghost-bip85-child-1.txt',
  '02-zoo-bip85-child-0.txt', '02-zoo-bip85-child-1.txt']) {
  if (decode(file(name)).split(/\s+/).length !== 12) throw new Error(`Invalid child seed ${name}`);
}
for (const id of ['ghost', 'zoo']) {
  const hostImport = decode(file(`03-${id}-HOST-IMPORT.txt`));
  if (!hostImport.startsWith('bip39: ') || hostImport.split(/\s+/).length !== 13) {
    throw new Error(`${id} host import is not a firmware-compatible BIP39 command`);
  }
}
const multisig = JSON.parse(decode(file('testnet-ghost-zoo-mirror-2of3.json')));
if (!multisig.descriptor.startsWith('wsh(sortedmulti(2,') ||
    !multisig.descriptor.includes('[74d682c3/48h/1h/0h/2h]') ||
    (multisig.descriptor.match(/tpub/g) || []).length !== 3) {
  throw new Error('Invalid 2-of-3 public cosigner descriptor');
}
if ('mirror' in demo.roots || demo.files.some(candidate => /mirror.*seed/i.test(candidate.name))) {
  throw new Error('Mirror must remain public-only');
}
for (const name of ['testnet-ghost-payment-low-fee.psbt', 'testnet-ghost-payment-high-fee.psbt']) {
  if (!Buffer.from(decode(file(name)), 'base64').subarray(0, 5).equals(Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff]))) {
    throw new Error(`Invalid PSBT ${name}`);
  }
}
console.log(JSON.stringify({ result: 'pass', files: demo.files.length, multisig: '2-of-3', mirror: 'public-only' }));
