import { createDemoFiles } from '../simulators/demo-data.js';

const demo = createDemoFiles('ghost');
const decode = file => new TextDecoder().decode(file.bytes).trim();
const file = name => demo.files.find(candidate => candidate.name === name);
if (!file('01-ghost-PUBLIC-TEST-SEED.txt') ||
    decode(file('01-ghost-PUBLIC-TEST-SEED.txt')) !== 'ghost ghost ghost ghost ghost ghost ghost ghost ghost ghost ghost machine') {
  throw new Error('Ghost BIP39 test vector is missing');
}
if (!file('01-zoo-PUBLIC-TEST-SEED.txt') ||
    decode(file('01-zoo-PUBLIC-TEST-SEED.txt')) !== 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong') {
  throw new Error('Zoo BIP39 test vector is missing');
}
for (const root of ['ghost', 'zoo']) {
  for (const index of [0, 1]) {
    if (decode(file(`02-${root}-bip85-child-${index}.txt`)).split(/\s+/).length !== 12) {
      throw new Error(`${root} BIP85 child ${index} is not a 12-word mnemonic`);
    }
  }
}
if (decode(file('02-ghost-bip85-child-0.txt')) !==
    'forget pumpkin lumber cherry print casino resist three public accident toddler admit' ||
    decode(file('02-zoo-bip85-child-0.txt')) !==
    'salt option burden habit silent tone breeze fade idle dilemma subway mix') {
  throw new Error('BIP85 index 0 derivations changed');
}
const walletFiles = demo.files.filter(candidate => candidate.name.endsWith('.json'));
if (!walletFiles.some(candidate => candidate.name.startsWith('testnet-')) ||
    !walletFiles.some(candidate => candidate.name.startsWith('mainnet-'))) {
  throw new Error('Demo set must contain testnet and mainnet wallets');
}
for (const name of ['testnet-ghost-legacy.json', 'testnet-ghost-taproot.json',
  'testnet-ghost-zoo-timelock.json',
  'testnet-ghost-payment-low-fee.psbt', 'testnet-ghost-payment-high-fee.psbt',
  'testnet-verify-ghost-address.txt']) {
  if (!file(name)) throw new Error(`Missing demo scenario ${name}`);
}
const multisig = JSON.parse(decode(file('testnet-ghost-zoo-mirror-2of3.json')));
if (!multisig.descriptor.startsWith('wsh(sortedmulti(2,') ||
    !multisig.descriptor.includes('[74d682c3/48h/1h/0h/2h]') ||
    (multisig.descriptor.match(/tpub/g) || []).length !== 3) {
  throw new Error('Mirror public cosigner is missing from the 2-of-3 multisig');
}
if ('mirror' in demo.roots || demo.files.some(candidate => /mirror.*seed/i.test(candidate.name))) {
  throw new Error('Mirror must remain a public-only cosigner');
}
for (const name of ['testnet-ghost-payment-low-fee.psbt', 'testnet-ghost-payment-high-fee.psbt']) {
  if (!Buffer.from(decode(file(name)), 'base64').subarray(0, 5).equals(Buffer.from([0x70, 0x73, 0x62, 0x74, 0xff]))) {
    throw new Error(`Invalid PSBT fixture ${name}`);
  }
}
for (const candidate of walletFiles) {
  const wallet = JSON.parse(decode(candidate));
  if (!wallet.descriptor || !wallet.address || wallet.warning !== 'UNSAFE PUBLIC TEST DATA') {
    throw new Error(`Invalid wallet fixture ${candidate.name}`);
  }
}
if (createDemoFiles('zoo').secondary !== 'ghost') throw new Error('Card assignment did not swap');
console.log(JSON.stringify({ result: 'pass', files: demo.files.length, walletFiles: walletFiles.length }));
