import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Transaction, networks, payments } from 'bitcoinjs-lib';

const temporary = resolve('.browser-work/bluewallet-network-test-adapter.cjs');
const require = createRequire(import.meta.url);
await mkdir(resolve('.browser-work'), { recursive: true });
await build({
  entryPoints: ['bluewallet-web/electrum.ts'],
  outfile: temporary,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'silent',
});

const originalFetch = globalThis.fetch;
const genesis = '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943';
const blockHash = 'ab'.repeat(32);
const payment = payments.p2wpkh({ hash: Buffer.alloc(20, 4), network: networks.testnet });
const previous = new Transaction();
previous.addInput(Buffer.alloc(32, 9), 0, 0xffffffff);
previous.addOutput(payment.output, 100_000);
const previousTxid = previous.getId();
const tx = new Transaction();
tx.addInput(Buffer.from(previousTxid, 'hex').reverse(), 0, 0xfffffffd);
tx.addOutput(payment.output, 98_000);
const txid = tx.getId();
const tip = 5_157_049;
const transactionStatus = { confirmed: true, block_height: tip - 2, block_hash: blockHash, block_time: 1_700_000_000 };
const txDetails = (transaction, id, status, inputs, value) => ({
  txid: id, version: transaction.version, locktime: transaction.locktime,
  size: transaction.byteLength(), weight: transaction.weight(), fee: 2_000, status,
  vin: inputs,
  vout: [{
    value, scriptpubkey: payment.output.toString('hex'), scriptpubkey_asm: '0 04...',
    scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: payment.address,
  }],
});
const previousDetails = txDetails(previous, previousTxid, { confirmed: true, block_height: 500 }, [{
  txid: '09'.repeat(32), vout: 0, scriptsig: '', scriptsig_asm: '', witness: [], sequence: 0xffffffff,
}], 100_000);
const currentDetails = txDetails(tx, txid, transactionStatus, [{
  txid: previousTxid, vout: 0, scriptsig: '', scriptsig_asm: '', witness: [],
  sequence: 0xfffffffd,
  prevout: { value: 100_000, scriptpubkey: payment.output.toString('hex'), scriptpubkey_type: 'v0_p2wpkh', scriptpubkey_address: payment.address },
}], 98_000);
const calls = [];

try {
  const api = require(temporary);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://blockstream.info');
    assert.equal(options.credentials, 'omit');
    const path = url.pathname.slice('/testnet/api'.length);
    const method = options.method || 'GET';
    calls.push({ path, method });
    let result;
    let contentType = 'application/json';
    if (method === 'POST' && path === '/tx') {
      assert.equal(options.body, tx.toHex());
      result = txid;
      contentType = 'text/plain';
    } else if (path === '/blocks/tip/height') {
      result = String(tip);
      contentType = 'text/plain';
    } else if (path === '/block-height/0') {
      result = genesis;
      contentType = 'text/plain';
    } else if (path === '/block-height/100') {
      result = blockHash;
      contentType = 'text/plain';
    } else if (path === '/block/' + blockHash) {
      result = { timestamp: 1_700_000_000 };
    } else if (path === '/fee-estimates') {
      result = { 1: 2.1, 6: 1.4, 24: 1 };
    } else if (path === '/address/' + payment.address) {
      result = {
        chain_stats: { funded_txo_sum: 200_000, spent_txo_sum: 50_000 },
        mempool_stats: { funded_txo_sum: 1_000, spent_txo_sum: 4_000 },
      };
    } else if (path === '/address/' + payment.address + '/utxo') {
      result = [{ txid: previousTxid, vout: 0, value: 100_000, status: { confirmed: true, block_height: 500 } }];
    } else if (path === '/address/' + payment.address + '/txs') {
      result = [currentDetails];
    } else if (path === '/address/' + payment.address + '/txs/mempool') {
      result = [{ txid: '33'.repeat(32), fee: 800 }];
    } else if (path === '/tx/' + txid + '/hex') {
      result = tx.toHex();
      contentType = 'text/plain';
    } else if (path === '/tx/' + previousTxid + '/hex') {
      result = previous.toHex();
      contentType = 'text/plain';
    } else if (path === '/tx/' + txid) {
      result = currentDetails;
    } else if (path === '/tx/' + previousTxid) {
      result = previousDetails;
    } else {
      throw new Error('Unexpected Testnet3 API request: ' + method + ' ' + path);
    }
    return new Response(typeof result === 'string' ? result : JSON.stringify(result), {
      headers: { 'content-type': contentType },
    });
  };

  assert.equal(api.TESTNET_NETWORK, 'testnet3');
  assert.equal(api.TESTNET_API, 'https://blockstream.info/testnet/api');
  assert.equal(await api.ensureConnected(), true);
  assert.equal(api.isConnected(), true);
  const states = [];
  const unsubscribe = api.subscribeConnectionState((state) => states.push(state));
  assert.equal(api.getConnectionState(), 'connected');
  assert.equal((await api.getConfig()).host, 'blockstream.info');
  assert.match(await api.getServerBanner(), /Testnet3/);
  assert.deepEqual(await api.serverFeatures(), {
    genesis_hash: genesis,
    hash_function: 'sha256',
    network: 'testnet3',
    server_version: 'Blockstream Esplora HTTPS',
  });
  assert.deepEqual(await api.getBalanceByAddress(payment.address), { confirmed: 150_000, unconfirmed: -3_000 });
  assert.deepEqual((await api.multiGetBalanceByAddress([payment.address])).addresses[payment.address], {
    confirmed: 150_000, unconfirmed: -3_000,
  });
  assert.deepEqual((await api.multiGetUtxoByAddress([payment.address]))[payment.address][0], {
    height: 500, value: 100_000, address: payment.address, txid: previousTxid, vout: 0,
  });
  assert.equal((await api.getTransactionsByAddress(payment.address))[0].height, tip - 2);
  assert.equal((await api.getMempoolTransactionsByAddress(payment.address))[0].fee, 800);
  assert.equal((await api.multiGetTransactionByTxid([txid], false))[txid], tx.toHex());
  const verbose = (await api.multiGetTransactionByTxid([txid], true))[txid];
  assert.equal(verbose.confirmations, 3);
  assert.equal(verbose.vin[0].value, 0.001);
  assert.equal(verbose.vout[0].value, 0.00098);
  const full = (await api.getTransactionsFullByAddress(payment.address))[0];
  assert.equal(full.inputs[0].value, 0.001);
  assert.deepEqual(full.inputs[0].addresses, [payment.address]);
  assert.equal((await api.estimateFees()).fast, 3);
  assert.equal((await api.estimateFees()).medium, 2);
  assert.equal((await api.estimateFee(24)), 1);
  assert.deepEqual(await api.getBlockTimestamps([100]), { 100: 1_700_000_000 });
  assert.equal(await api.broadcastV2(tx.toHex()), txid);
  assert(calls.some((call) => call.method === 'POST' && call.path === '/tx'));
  await assert.rejects(api.broadcastV2('00'), /Invalid serialized Bitcoin Testnet3 transaction/);
  assert.equal(await api.testConnection('blockstream.info/testnet/api', false, 443), true);
  assert.equal(await api.testConnection('electrum.mainnet.example', false, 50002), false);
  await api.setDisabled(true);
  assert.equal(api.getConnectionState(), 'disabled');
  assert.equal(await api.ensureConnected(), false);
  await assert.rejects(api.getBalanceByAddress(payment.address), /connection is disabled/);
  await api.setDisabled(false);
  assert.equal(api.isConnected(), true);
  api.forceDisconnect();
  assert.equal(api.getConnectionState(), 'disconnected');
  assert.equal(await api.ensureConnected(), true);
  assert(states.includes('connecting') && states.includes('disabled') && states.includes('disconnected'));
  unsubscribe();
  if (process.env.TEST_BLUEWALLET_LIVE_NETWORK === '1') {
    globalThis.fetch = originalFetch;
    api.forceDisconnect();
    assert.equal(await api.ensureConnected(), true);
    const features = await api.serverFeatures();
    const liveTip = await api.getCurrentBlockTip();
    const liveFees = await api.estimateFees();
    assert.equal(features.genesis_hash, genesis);
    assert.ok(liveTip > 0);
    assert.ok(liveFees.fast > 0 && liveFees.medium > 0 && liveFees.slow > 0);
    console.log(JSON.stringify({ result: 'bluewallet-live-testnet3-https-passed', height: liveTip,
      genesisHash: features.genesis_hash, fees: liveFees, externalBroadcastPerformed: false }));
  }
  console.log(JSON.stringify({
    result: 'bluewallet-testnet3-esplora-passed',
    network: 'testnet3',
    endpoint: api.TESTNET_API,
    balanceUtxoHistoryFees: true,
    signedTransactionBroadcastTransport: true,
    genesisVerified: true,
    externalBroadcastPerformed: false,
  }));
} finally {
  globalThis.fetch = originalFetch;
  await unlink(temporary).catch(() => {});
}
