const roots = {
  ghost: {
    label: 'Ghost test seed',
    mnemonic: 'ghost ghost ghost ghost ghost ghost ghost ghost ghost ghost ghost machine',
    children: [
      'forget pumpkin lumber cherry print casino resist three public accident toddler admit',
      'diamond wish drip energy toss mean budget novel lift print ocean label',
    ],
  },
  zoo: {
    label: 'Zoo test seed',
    mnemonic: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    children: [
      'salt option burden habit silent tone breeze fade idle dilemma subway mix',
      'also voice raise tray tree detail exchange run start still cube actual',
    ],
  },
};

const wallets = [
  ['testnet-ghost-zoo-mirror-2of3.json', 'Testnet Ghost + Zoo + Mirror 2-of-3', 'wsh(sortedmulti(2,[8c24a510/48h/1h/0h/2h]tpubDDzWqfZ5TH48383Byd9PFGxEP1Ws5NVXyYcHTmnHwmhJciowLeBDWNHcpLGocofanSyVHeiNqL4HZkXZfKM7NKm7gZZoPjmA9vTKPpwRSkx/{0,1}/*,[3f635a63/48h/1h/0h/2h]tpubDFPtPArj4GzBEFHohegg1Xatrc1Fi9oSox5LzuSRX91miwQxuUrEpBxpvDRsmZYJKYFhgdK3UStsjC8JKXfUbMinjFqiEM4uNwzVaCaHpys/{0,1}/*,[74d682c3/48h/1h/0h/2h]tpubDFj1hZAYMiqqHgrVQ98sLcStdrnAhNx74ynU6QFDULUhyp1BDeyz6E76HPN16t1fswttuwijEsMnskuZPtCvtdbHt74Rs8Vfk3JsM86wah7/{0,1}/*))#syw6qp8z', 'tb1qem2p9awpmhyts2rrg7wxnze0qm4znep7zl032qwrh0yy4m36364qhza3rn'],
];

export function createDemoFiles(primary = 'ghost') {
  if (!(primary in roots)) throw new Error('Unknown demo seed');
  const secondary = primary === 'ghost' ? 'zoo' : 'ghost';
  const files = [];
  const add = (name, text) => files.push({ name, bytes: new TextEncoder().encode(text) });
  add('00-CLAVASTACK-DEMO-README.txt', [
    'UNSAFE PUBLIC TEST DATA - NEVER USE FOR REAL FUNDS', '',
    `MemoryCard 1 prepared seed: ${roots[primary].label}`,
    `MemoryCard 2 prepared seed: ${roots[secondary].label}`,
    '2-of-3 multisig: Ghost + Zoo + public-only Mirror cosigner (fingerprint 74d682c3).',
    'The Mirror mnemonic is deliberately not included or stored.',
    'The card seed is written only after you confirm Save key to the card in Specter DIY.',
    'Testnet only. The multisig JSON contains the single demo receive address.',
  ].join('\n'));
  for (const [id, root] of Object.entries(roots)) {
    add(`01-${id}-PUBLIC-TEST-SEED.txt`, `${root.mnemonic}\n`);
    root.children.forEach((mnemonic, index) => add(`02-${id}-bip85-child-${index}.txt`, `${mnemonic}\n`));
  }
  for (const [name, label, descriptor, address] of wallets) {
    add(name, `${JSON.stringify({ label, descriptor, address, warning: 'UNSAFE PUBLIC TEST DATA' }, null, 2)}\n`);
  }
  add('testnet-ghost-payment-low-fee.psbt', 'cHNidP8BAHECAAAAASIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiAAAAAAD9////AmDqAAAAAAAAFgAUx6q7+sTbbs7TU1rVoghQnTkhKctMmgAAAAAAABYAFOeecUR7lROm99MUyL5extM/T11XAAAAAAABAR+ghgEAAAAAABYAFGLab1CVpSs0DBrqUxM0E2SvvC6OIgYDMe3LFs/Q+FmAUveyh7BwR6EcYJZ8Hn6wJX4CVSU52YQYjCSlEFQAAIABAACAAAAAgAAAAAAAAAAAAAAiAgIlH+LuS8Q3KbCQP/rbz4RtnmrLs6pZOwnWAIVkXL42UxiMJKUQVAAAgAEAAIAAAACAAQAAAAAAAAAA\n');
  add('testnet-ghost-payment-high-fee.psbt', 'cHNidP8BAHECAAAAATMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzAAAAAAD9////AmDqAAAAAAAAFgAUx6q7+sTbbs7TU1rVoghQnTkhKcu4iAAAAAAAABYAFOeecUR7lROm99MUyL5extM/T11XAAAAAAABAR+ghgEAAAAAABYAFGLab1CVpSs0DBrqUxM0E2SvvC6OIgYDMe3LFs/Q+FmAUveyh7BwR6EcYJZ8Hn6wJX4CVSU52YQYjCSlEFQAAIABAACAAAAAgAAAAAAAAAAAAAAiAgIlH+LuS8Q3KbCQP/rbz4RtnmrLs6pZOwnWAIVkXL42UxiMJKUQVAAAgAEAAIAAAACAAQAAAAAAAAAA\n');
  return { files, roots, primary, secondary };
}
