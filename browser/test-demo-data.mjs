import { createDemoFiles } from './demo-data.js';
import { createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';

const demo = createDemoFiles();
const mainnetDemo = createDemoFiles('mainnet');
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
if (demo.files.length !== 11) throw new Error(`Expected 11 focused demo files, got ${demo.files.length}`);
if (demo.files.some(candidate => /HOST-IMPORT|addresses|verify/i.test(candidate.name))) {
  throw new Error('Removed host or redundant address files returned');
}
if (demo.files.filter(candidate => candidate.name.endsWith('.json')).length !== 1) {
  throw new Error('Testnet must include its public multisig wallet JSON');
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
const mainnetDescriptor = JSON.parse(decode(mainnetDemo.files.find(candidate => candidate.name === 'mainnet-ghost-wallet.json')));
if (!mainnetDescriptor.descriptor.startsWith('wpkh([8c24a510/84h/0h/0h]xpub') ||
    !mainnetDescriptor.descriptor.endsWith('#0hgg3ucc') ||
    !mainnetDescriptor.address.startsWith('bc1q') ||
    !mainnetDescriptor.warning.includes('NEVER SEND OR STORE REAL FUNDS') ||
    !decode(mainnetDemo.files.find(candidate => candidate.name === '00-CLAVASTACK-DEMO-README.txt')).includes('Never send real funds')) {
  throw new Error('Mainnet demo wallet or safety note is invalid');
}
const mainnetZoo = JSON.parse(decode(mainnetDemo.files.find(candidate => candidate.name === 'mainnet-zoo-wallet.json')));
if (mainnetZoo.address !== 'bc1qk0a9hr7wjfxeenz9nwenw9flhq0tmsf6vsgnn2' ||
    !mainnetZoo.descriptor.startsWith('wpkh([3f635a63/84h/0h/0h]xpub') ||
    mainnetZoo.descriptor !== 'wpkh([3f635a63/84h/0h/0h]xpub6CYYYw6h668PkCSXxH9yxBG32zCMEb6N9DuVY8Ax8U7RSV86qKrrhjJfS6nL5jSoikLpd1Qw9qgHv5vyRi7V4nfV3ymLfGpFShsYsFmQiT8/0/*)#9m66mdj4' ||
    mainnetDemo.files.length !== 11 ||
    !Buffer.from(mainnetDemo.cards[0].secret).equals(Buffer.from(demo.cards[0].secret)) ||
    !Buffer.from(mainnetDemo.cards[1].secret).equals(Buffer.from(demo.cards[1].secret))) {
  throw new Error('Mainnet demo does not use the same public demo seeds and MemoryCards');
}
const compact = (buffer, state) => {
  const prefix = buffer[state.offset++];
  if (prefix < 0xfd) return prefix;
  const bytes = prefix === 0xfd ? 2 : prefix === 0xfe ? 4 : 8;
  const value = bytes === 8 ? Number(buffer.readBigUInt64LE(state.offset)) : buffer.readUIntLE(state.offset, bytes);
  state.offset += bytes;
  return value;
};
const readMap = (buffer, state) => {
  const entries = [];
  while (buffer[state.offset] !== 0) {
    const keyLength = compact(buffer, state);
    const key = buffer.subarray(state.offset, state.offset += keyLength);
    const valueLength = compact(buffer, state);
    const value = buffer.subarray(state.offset, state.offset += valueLength);
    entries.push({ key, value });
  }
  state.offset++;
  return entries;
};
const readTxOutputs = tx => {
  const state = { offset: 4 };
  const inputCount = compact(tx, state);
  for (let index = 0; index < inputCount; index++) {
    state.offset += 36;
    const scriptLength = compact(tx, state);
    state.offset += scriptLength + 4;
  }
  const outputCount = compact(tx, state);
  const outputs = [];
  for (let index = 0; index < outputCount; index++) {
    const value = Number(tx.readBigUInt64LE(state.offset)); state.offset += 8;
    const scriptLength = compact(tx, state);
    outputs.push({ value, script: tx.subarray(state.offset, state.offset += scriptLength) });
  }
  return outputs;
};
const mainnetTxSpecs = [
  { name: 'mainnet-ghost-payment-low-fee.psbt', inputKey: '0282956c4c7e1ee668cf1212e3e78790c532a314a1add365148288683167bb8741', fee: 500, index: 0 },
  { name: 'mainnet-ghost-payment-high-fee.psbt', inputKey: '024b4764191c8ad71948d555b6d99e10ec5464449ddac4682e03b8fe7d39fba297', fee: 5000, index: 1 },
];
const hash160 = key => createHash('ripemd160').update(createHash('sha256').update(key).digest()).digest();
const zooPubkey = Buffer.from('030756317ceec8a038de22a93abac5ea45b6cf496a9a32fb19008c460f468da4ed', 'hex');
for (const spec of mainnetTxSpecs) {
  const raw = Buffer.from(decode(mainnetDemo.files.find(candidate => candidate.name === spec.name)), 'base64');
  if (!raw.subarray(0, 5).equals(Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff]))) throw new Error(`Invalid PSBT: ${spec.name}`);
  const state = { offset: 5 };
  const global = readMap(raw, state);
  const unsignedTx = global.find(entry => entry.key.equals(Buffer.from([0x00])))?.value;
  if (!unsignedTx) throw new Error(`Missing unsigned transaction: ${spec.name}`);
  const txOutputs = readTxOutputs(unsignedTx);
  const inputMap = readMap(raw, state);
  const outputMaps = txOutputs.map(() => readMap(raw, state));
  const derivation = inputMap.find(entry => entry.key[0] === 0x06);
  const utxo = inputMap.find(entry => entry.key.equals(Buffer.from([0x01])))?.value;
  if (!derivation || derivation.key.subarray(1).toString('hex') !== spec.inputKey || !utxo) {
    throw new Error(`Mainnet input key does not match Ghost seed: ${spec.name}`);
  }
  const path = [];
  for (let offset = 4; offset < derivation.value.length; offset += 4) path.push(derivation.value.readUInt32LE(offset));
  if (derivation.value.subarray(0, 4).toString('hex') !== '00000000' ||
      path.join(',') !== [0x80000054, 0x80000000, 0x80000000, 0, spec.index].join(',')) {
    throw new Error(`Mainnet input path is not Ghost BIP84 coin type 0: ${spec.name}`);
  }
  const inputValue = Number(utxo.readBigUInt64LE(0));
  const inputScriptLength = compact(utxo, { offset: 8 });
  const inputScript = utxo.subarray(9, 9 + inputScriptLength);
  if (inputValue !== 100000 || !inputScript.equals(Buffer.concat([Buffer.from('0014', 'hex'), hash160(derivation.key.subarray(1))]))) {
    throw new Error(`Mainnet input UTXO does not pay the derived Ghost key: ${spec.name}`);
  }
  if (txOutputs.length !== 1 || txOutputs[0].value !== 100000 - spec.fee ||
      !txOutputs[0].script.equals(Buffer.concat([Buffer.from('0014', 'hex'), hash160(zooPubkey)])) ||
      outputMaps.flat().length !== 0) {
    throw new Error(`Mainnet output does not pay the separate Zoo wallet or fee is wrong: ${spec.name}`);
  }
  if (state.offset !== raw.length) throw new Error(`Malformed PSBT maps: ${spec.name}`);
}
for (const name of ['testnet-ghost-payment-low-fee.psbt', 'testnet-ghost-payment-high-fee.psbt',
  'testnet-multisig-unsigned.psbt']) {
  if (!Buffer.from(decode(file(name)), 'base64').subarray(0, 5).equals(Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff]))) {
    throw new Error(`Invalid PSBT ${name}`);
  }
}
const unsignedMultisig = Buffer.from(decode(file('testnet-multisig-unsigned.psbt')), 'base64');
let offset = 5;
const compactSize = () => {
  const prefix = unsignedMultisig[offset++];
  if (prefix < 0xfd) return prefix;
  if (prefix === 0xfd) { const value = unsignedMultisig.readUInt16LE(offset); offset += 2; return value; }
  throw new Error('Unexpected large compact size in demo PSBT');
};
const map = () => {
  const entries = [];
  while (unsignedMultisig[offset] !== 0) {
    const keyLength = compactSize();
    const key = unsignedMultisig.subarray(offset, offset += keyLength);
    const valueLength = compactSize();
    const value = unsignedMultisig.subarray(offset, offset += valueLength);
    entries.push({ key, value });
  }
  offset++;
  return entries;
};
map();
const inputEntries = map();
const fingerprints = inputEntries.filter(entry => entry.key[0] === 0x06)
  .map(entry => entry.value.subarray(0, 4).toString('hex')).sort();
if (inputEntries.some(entry => entry.key[0] === 0x02) ||
    fingerprints.join(',') !== ['3f635a63', '74d682c3', '8c24a510'].sort().join(',')) {
  throw new Error('Multisig PSBT must be unsigned and contain all three cosigner derivations');
}
console.log(JSON.stringify({ result: 'pass', files: demo.files.length, multisig: '2-of-3',
  mirror: 'public-only', cards: demo.cards.map(card => `${card.id}:plain:PIN-${card.pin}`) }));
