import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { transform } from 'esbuild';
import { Transaction, networks, payments, crypto as bitcoinCrypto } from 'bitcoinjs-lib';

const source = await readFile('keeper-web/adapters/browser-electrum-transport.web.ts', 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'esm' });
await mkdir('.browser-work', { recursive: true });
const temporary = '.browser-work/keeper-network-test-adapter.mjs';
await writeFile(temporary, compiled.code);
const originalFetch = globalThis.fetch;
try {
  const { default: Transport, TESTNET_NODE_HOST, TESTNET_API } = await import(pathToFileURL(`${process.cwd()}/${temporary}`));
  const tx = new Transaction();
  tx.addInput(Buffer.alloc(32, 42), 0, 0xfffffffd);
  const address = payments.p2wpkh({ hash: Buffer.alloc(20, 1), network: networks.testnet });
  tx.addOutput(address.output, 99_000);
  const txid = tx.getId();
  const txData = {
    txid, version: tx.version, locktime: tx.locktime, size: tx.byteLength(), weight: tx.weight(),
    status: { confirmed: true, block_height: 100, block_hash: 'ab'.repeat(32), block_time: 1_700_000_000 },
    vin: [{ txid: '2a'.repeat(32), vout: 0, scriptsig: '', scriptsig_asm: '', sequence: 0xfffffffd,
      prevout: { value: 100_000, scriptpubkey_address: address.address } }],
    vout: [{ value: 99_000, scriptpubkey: address.output.toString('hex'), scriptpubkey_asm: '',
      scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: address.address }],
  };
  const hash = '0123456789abcdef'.repeat(4);
  const apiHash = Buffer.from(hash, 'hex').reverse().toString('hex');
  const firstHistory = Array.from({ length: 25 }, (_, index) => ({
    txid: index.toString(16).padStart(64, '0'), status: { confirmed: true, block_height: 100 - index },
  }));
  let active = 0;
  let peak = 0;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    assert.ok(url.startsWith(TESTNET_API));
    assert.equal(options.credentials, 'omit');
    const path = url.slice(TESTNET_API.length);
    calls.push({ path, method: options.method });
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    active--;
    let result;
    if (path === '/blocks/tip/height') result = '200';
    else if (path === '/block-height/0') result = '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943';
    else if (path === '/block-height/200') result = 'ab'.repeat(32);
    else if (path === `/block/${'ab'.repeat(32)}/header`) result = '00'.repeat(80);
    else if (path.endsWith('/utxo')) result = [{ txid, vout: 0, value: 99_000, status: txData.status }];
    else if (path === `/scripthash/${apiHash}/txs`) result = firstHistory;
    else if (path.startsWith(`/scripthash/${apiHash}/txs/chain/`)) result = [{ txid, status: txData.status }];
    else if (path === `/tx/${txid}/hex`) result = tx.toHex();
    else if (path === `/tx/${txid}`) result = txData;
    else if (path === '/fee-estimates') result = { 1: 2, 6: 0.5 };
    else if (path === '/tx') { assert.equal(options.body, tx.toHex()); result = txid; }
    else throw new Error(`Unexpected API request: ${path}`);
    const json = typeof result !== 'string';
    return new Response(json ? JSON.stringify(result) : result, {
      headers: { 'content-type': json ? 'application/json' : 'text/plain' },
    });
  };

  const client = new Transport(null, null, '443', TESTNET_NODE_HOST, 'tls');
  assert.ok((await client.initElectrum({}))[0]);
  assert.equal((await client.server_features()).network, 'testnet3');
  assert.deepEqual(await client.blockchainHeaders_subscribe(), { height: 200, hex: '00'.repeat(80) });
  const utxos = await client.blockchainScripthash_listunspentBatch([hash]);
  assert.deepEqual(utxos, [{ param: hash, result: [{ tx_hash: txid, tx_pos: 0, value: 99_000, height: 100 }] }]);
  const history = await client.blockchainScripthash_getHistoryBatch([hash]);
  assert.equal(history[0].result.length, 26);
  assert.equal(history[0].result.at(-1).tx_hash, txid);
  const verbose = (await client.blockchainTransaction_getBatch([txid]))[0].result;
  assert.equal(verbose.confirmations, 101);
  assert.equal(verbose.vin[0].value, 0.001);
  assert.equal(verbose.vout[0].value, 0.00099);
  assert.deepEqual(verbose.vout[0].scriptPubKey.addresses, [address.address]);
  assert.equal((await client.blockchainTransaction_getBatch([txid], false))[0].result, tx.toHex());
  assert.equal(await client.blockchainEstimatefee(6), 0.5 * 1024 / 1e8);
  assert.equal(await client.blockchainTransaction_broadcast(tx.toHex()), txid);
  await client.blockchainScripthash_listunspentBatch(Array.from({ length: 12 }, (_, index) => index.toString(16).padStart(64, '0')));
  assert.ok(peak <= 4, `HTTP concurrency exceeded four: ${peak}`);
  await assert.rejects(client.blockchainScripthash_listunspentBatch(['bad']), /Invalid script hash/);
  const mainnet = new Transport(null, null, '50002', 'electrum.emzy.de', 'tls');
  await assert.rejects(mainnet.initElectrum({}), /Testnet3 HTTPS/);
  globalThis.fetch = async () => new Response('Backend unavailable', { status: 503 });
  await assert.rejects(client.server_ping(), /503.*Backend unavailable/);
  client.close();
  await assert.rejects(client.server_ping(), /closed/);
  console.log(JSON.stringify({ result: 'keeper-https-transport-passed', historyPagination: true,
    bitcoinUnitConversion: true, transactionBytesChecked: true, peakConcurrency: peak,
    mainnetRejected: true, backendErrorsPreserved: true, requests: calls.length }));

  if (process.env.TEST_KEEPER_LIVE_NETWORK === '1') {
    globalThis.fetch = originalFetch;
    const live = new Transport(null, null, '443', TESTNET_NODE_HOST, 'tls');
    await live.initElectrum({});
    const headers = await live.blockchainHeaders_subscribe();
    assert.equal(headers.hex.length, 160);
    const features = await live.server_features();
    assert.match(features.genesis_hash, /^[0-9a-f]{64}$/);
    const unusedScriptHash = Buffer.from(bitcoinCrypto.sha256(randomBytes(32))).reverse().toString('hex');
    const empty = await live.blockchainScripthash_listunspentBatch([unusedScriptHash]);
    assert.deepEqual(empty[0].result, []);
    const unusedHistory = await live.blockchainScripthash_getHistoryBatch([unusedScriptHash]);
    assert.deepEqual(unusedHistory[0].result, []);
    const latestTxids = await originalFetch(`${TESTNET_API}/block/${await (await originalFetch(`${TESTNET_API}/block-height/${headers.height}`)).text()}/txids`).then((response) => response.json());
    const latest = (await live.blockchainTransaction_getBatch([latestTxids[0]]))[0].result;
    assert.ok(latest.confirmations >= 1);
    assert.ok(latest.vout.length > 0, 'Latest Testnet3 transaction has no outputs.');
    assert.ok(await live.blockchainEstimatefee(6) > 0);
    console.log(JSON.stringify({ result: 'live-testnet3-https-passed', height: headers.height,
      genesisHash: features.genesis_hash, transaction: latest.txid, confirmations: latest.confirmations }));
    live.close();
  }
} finally {
  globalThis.fetch = originalFetch;
  await unlink(temporary);
}
