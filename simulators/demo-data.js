const roots = {
  ghost: {
    label: 'Ghost test seed', fingerprint: '8c24a510',
    mnemonic: 'ghost ghost ghost ghost ghost ghost ghost ghost ghost ghost ghost machine',
    children: [
      'forget pumpkin lumber cherry print casino resist three public accident toddler admit',
      'diamond wish drip energy toss mean budget novel lift print ocean label',
    ],
  },
  zoo: {
    label: 'Zoo test seed', fingerprint: '3f635a63',
    mnemonic: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    children: [
      'salt option burden habit silent tone breeze fade idle dilemma subway mix',
      'also voice raise tray tree detail exchange run start still cube actual',
    ],
  },
};

const wallets = [
  ['testnet-ghost-legacy.json', 'Testnet Ghost Legacy', 'pkh([8c24a510/44h/1h/0h]tpubDChrvFbjMGH4tDKK6BZ6nvp1FAPFUgRvNLUpGt8JnBYcvCaX8VWP2p5mFSMaSJh4vHhYfhyUgXS93JuV4oTbPfYzYiTxhoB8PjegrupnbVk/{0,1}/*)#hyd6tufc', 'mkKEAPgJtgmY9C9UuHuzPjtssem7wFtgcv'],
  ['testnet-ghost-native-segwit.json', 'Testnet Ghost Native SegWit', 'wpkh([8c24a510/84h/1h/0h]tpubDC4DsqH5rqHqipMNqUbDFtQT3AkKkUrvLsN6miySvortU3s1LGaNVAb7wX2No2VsuxQV82T8s3HJLv3kdx1CPjsJ3onC1Zo5mWCQzRVaWVX/{0,1}/*)#79xgtl35', 'tb1qvtdx75y4554ngrq6aff3xdqnvjhmct5w6luehe'],
  ['testnet-ghost-taproot.json', 'Testnet Ghost Taproot', 'tr([8c24a510/86h/1h/0h]tpubDCtEgiqMKExrg9AJa37NjeCXNKQ57DwbwFYGznGfJszGt1be4GaWMnuyCA9Uk697efUbtogcMeyFiwmNyDzfyrGFRf3KSKPLhj6FkqLgUXi/{0,1}/*)#atzyqdly', 'tb1pkzxv85mtawuhte3fm0h5z5waegf2epjt428xgfgs7up6p93jqzts36dfz0'],
  ['testnet-ghost-account-2.json', 'Testnet Ghost Account 2', 'wpkh([8c24a510/84h/1h/1h]tpubDC4DsqH5rqHqjWindNDCnGNZucunzFgnQAqLZaAMbcRCq1qP3g9dtQSMyexJeyDd1ZzoP8nCxhaHeLT31fTdQeEknCs828m7KDWujKdSPbq/{0,1}/*)#hlkdcp3d', 'tb1q64fu9p0wf5gedyu7fzsdwrzjc97032fhdy9rz8'],
  ['testnet-zoo-watch-only.json', 'Testnet Zoo Watch-only', 'wpkh([3f635a63/84h/1h/0h]tpubDCgYNDYFCZpc5H8LExm81BQd8YcpJndx14YXjFV5XZrFxexwZKMVAycjDvmdLJELb6NgeVAM4UyGbqVqqdATXQh5FnYkS4C9DkzmFc9A86Z/{0,1}/*)#fu206e2q', 'tb1qc74th7kymdhva56ntt26yzzsn5ujz2wtqcyjz8'],
  ['testnet-ghost-zoo-2of2.json', 'Testnet Ghost + Zoo 2-of-2', 'wsh(sortedmulti(2,[8c24a510/48h/1h/0h/2h]tpubDDzWqfZ5TH48383Byd9PFGxEP1Ws5NVXyYcHTmnHwmhJciowLeBDWNHcpLGocofanSyVHeiNqL4HZkXZfKM7NKm7gZZoPjmA9vTKPpwRSkx/{0,1}/*,[3f635a63/48h/1h/0h/2h]tpubDFPtPArj4GzBEFHohegg1Xatrc1Fi9oSox5LzuSRX91miwQxuUrEpBxpvDRsmZYJKYFhgdK3UStsjC8JKXfUbMinjFqiEM4uNwzVaCaHpys/{0,1}/*))#rh703fa4', 'tb1qdspgdqxu86lmuxp6e62wz0pnprr9dxv6htej8qy4rnkdsmee7ckqyqfd87'],
  ['testnet-ghost-zoo-timelock.json', 'Testnet Ghost + Zoo Timelock', 'wsh(or_d(pk([8c24a510/48h/1h/0h/2h]tpubDDzWqfZ5TH48383Byd9PFGxEP1Ws5NVXyYcHTmnHwmhJciowLeBDWNHcpLGocofanSyVHeiNqL4HZkXZfKM7NKm7gZZoPjmA9vTKPpwRSkx/{0,1}/*),and_v(v:pk([3f635a63/48h/1h/0h/2h]tpubDFPtPArj4GzBEFHohegg1Xatrc1Fi9oSox5LzuSRX91miwQxuUrEpBxpvDRsmZYJKYFhgdK3UStsjC8JKXfUbMinjFqiEM4uNwzVaCaHpys/{0,1}/*),older(52560))))#vm6u0e6e', 'tb1qzkm59q72k8hussxvt60u3lmfl2n8vjgef385j2rtmm7zyjuach7qq5vpw2'],
  ['mainnet-ghost-native-segwit.json', 'Mainnet Ghost Native SegWit (test data)', 'wpkh([8c24a510/84h/0h/0h]xpub6CjsHfiuBnHMPBkxThQ4DDjTw2Qq3VMEVcPBoMBGejZGkj3WQR15LeJLmymPpSzYHX21C8SdFWHgMw2RUBdAQ2Aj4MMS93a68mxPQeS8oHr/{0,1}/*)#dwfgu6ex', 'bc1qwq5rv3p3vp4duhejkd9l88m7umudte4fur4c6q'],
  ['mainnet-zoo-watch-only.json', 'Mainnet Zoo Watch-only (test data)', 'wpkh([3f635a63/84h/0h/0h]xpub6CYYYw6h668PkCSXxH9yxBG32zCMEb6N9DuVY8Ax8U7RSV86qKrrhjJfS6nL5jSoikLpd1Qw9qgHv5vyRi7V4nfV3ymLfGpFShsYsFmQiT8/{0,1}/*)#k8vzy50p', 'bc1qk0a9hr7wjfxeenz9nwenw9flhq0tmsf6vsgnn2'],
];

export function createDemoFiles(primary = 'ghost') {
  if (!(primary in roots)) throw new Error('Unknown demo seed');
  const secondary = primary === 'ghost' ? 'zoo' : 'ghost';
  const files = [];
  const add = (name, text) => files.push({ name, bytes: new TextEncoder().encode(text) });
  add('00-CLAVASTACK-DEMO-README.txt', [
    'UNSAFE PUBLIC TEST DATA - NEVER USE FOR REAL FUNDS',
    '',
    `MemoryCard 1 assignment: ${roots[primary].label}`,
    `MemoryCard 2 assignment: ${roots[secondary].label}`,
    'The card seed is written only after you confirm Save key to the card in Specter DIY.',
    'Testnet wallet files are the primary examples. Mainnet files are included only for display comparisons.',
  ].join('\n'));
  for (const [id, root] of Object.entries(roots)) {
    add(`01-${id}-PUBLIC-TEST-SEED.txt`, `${root.mnemonic}\n`);
    root.children.forEach((mnemonic, index) => add(
      `02-${id}-bip85-child-${index}.txt`, `${mnemonic}\n`,
    ));
  }
  for (const [name, label, descriptor, address] of wallets) {
    add(name, `${JSON.stringify({ label, descriptor, address, warning: 'UNSAFE PUBLIC TEST DATA' }, null, 2)}\n`);
  }
  add('testnet-addresses.txt', wallets.filter(([name]) => name.startsWith('testnet-'))
    .map(([, label, , address]) => `${label}: ${address}`).join('\n') + '\n');
  add('testnet-verify-ghost-address.txt', 'bitcoin:tb1qvtdx75y4554ngrq6aff3xdqnvjhmct5w6luehe?index=0\n');
  add('testnet-ghost-payment-low-fee.psbt', 'cHNidP8BAHECAAAAASIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiAAAAAAD9////AmDqAAAAAAAAFgAUx6q7+sTbbs7TU1rVoghQnTkhKctMmgAAAAAAABYAFOeecUR7lROm99MUyL5extM/T11XAAAAAAABAR+ghgEAAAAAABYAFGLab1CVpSs0DBrqUxM0E2SvvC6OIgYDMe3LFs/Q+FmAUveyh7BwR6EcYJZ8Hn6wJX4CVSU52YQYjCSlEFQAAIABAACAAAAAgAAAAAAAAAAAAAAiAgIlH+LuS8Q3KbCQP/rbz4RtnmrLs6pZOwnWAIVkXL42UxiMJKUQVAAAgAEAAIAAAACAAQAAAAAAAAAA\n');
  add('testnet-ghost-payment-high-fee.psbt', 'cHNidP8BAHECAAAAATMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzAAAAAAD9////AmDqAAAAAAAAFgAUx6q7+sTbbs7TU1rVoghQnTkhKcu4iAAAAAAAABYAFOeecUR7lROm99MUyL5extM/T11XAAAAAAABAR+ghgEAAAAAABYAFGLab1CVpSs0DBrqUxM0E2SvvC6OIgYDMe3LFs/Q+FmAUveyh7BwR6EcYJZ8Hn6wJX4CVSU52YQYjCSlEFQAAIABAACAAAAAgAAAAAAAAAAAAAAiAgIlH+LuS8Q3KbCQP/rbz4RtnmrLs6pZOwnWAIVkXL42UxiMJKUQVAAAgAEAAIAAAACAAQAAAAAAAAAA\n');
  return { files, roots, primary, secondary };
}
