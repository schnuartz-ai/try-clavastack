import { createDemoFiles } from './demo-data.js';
import { createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';

const demo = createDemoFiles();
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
if (demo.files.length !== 10) throw new Error(`Expected 10 focused demo files, got ${demo.files.length}`);
if (demo.files.some(candidate => /HOST-IMPORT|mainnet|addresses|verify/i.test(candidate.name))) {
  throw new Error('Removed host, Mainnet or redundant address files returned');
}
if (demo.files.filter(candidate => candidate.name.endsWith('.json')).length !== 1) {
  throw new Error('Only the multisig wallet JSON may be stored');
}
const taggedHash = (tag, data) => {
  const tagHash = createHash('sha256').update(tag).digest();
  return createHash('sha256').update(Buffer.concat([tagHash, tagHash, data])).digest();
};
const cardKey = Buffer.alloc(32, 0xcc);
const aesKey = taggedHash('aes', cardKey);
const hmacKey = taggedHash('hmac', cardKey);
const expectedEntropy = {
  ghost: Buffer.from('YYwxhjDGGMMYYwxhjDGGQg==', 'base64'),
  zoo: Buffer.from('/////////////////////w==', 'base64'),
};
for (const card of demo.cards) {
  const secret = Buffer.from(card.secret);
  const body = secret.subarray(0, -32);
  const mac = createHmac('sha256', hmacKey).update(body).digest();
  if (!timingSafeEqual(mac, secret.subarray(-32))) throw new Error(`${card.id} card HMAC is invalid`);
  const decipher = createDecipheriv('aes-256-cbc', aesKey, body.subarray(10, 26));
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(body.subarray(26)), decipher.final()]);
  if (plain[0] !== 2 || plain[1] !== 16 || !plain.subarray(2, 18).equals(expectedEntropy[card.id])) {
    throw new Error(`${card.id} card does not contain the expected BIP39 entropy`);
  }
  if (!Buffer.from(card.pinDigest).equals(createHash('sha256').update(card.pin).digest())) {
    throw new Error(`${card.id} card PIN digest is invalid`);
  }
}
const multisig = JSON.parse(decode(file('testnet-ghost-zoo-mirror-2of3.json')));
if (!multisig.descriptor.startsWith('wsh(sortedmulti(2,') ||
    !multisig.descriptor.includes('[74d682c3/48h/1h/0h/2h]') ||
    (multisig.descriptor.match(/tpub/g) || []).length !== 3 ||
    !multisig.address.startsWith('tb1')) {
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
console.log(JSON.stringify({ result: 'pass', files: demo.files.length, multisig: '2-of-3',
  mirror: 'public-only', cards: demo.cards.map(card => `${card.id}:plain:PIN-${card.pin}`) }));
