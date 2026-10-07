import * as bitcoin from './bitcoin';
import { Transaction } from '../upstream/bluewallet/node_modules/bitcoinjs-lib';

export const TESTNET_API = 'https://blockstream.info/testnet/api';
export const TESTNET_HOST = 'blockstream.info';
export const TESTNET_NETWORK = 'testnet3';
export const TESTNET_GENESIS = '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943';

export const ELECTRUM_HOST = 'electrum_host';
export const ELECTRUM_TCP_PORT = 'electrum_tcp_port';
export const ELECTRUM_SSL_PORT = 'electrum_ssl_port';
export const ELECTRUM_SERVER_HISTORY = 'electrum_server_history';
export const ENSURE_CONNECTED_MAX_WALL_MS = 15_000;

export const hardcodedPeers = [{ host: TESTNET_HOST, ssl: 443 }];
export const suggestedServers = hardcodedPeers;

type ConnectionState = 'disabled' | 'disconnected' | 'connecting' | 'connected';
type Balance = { confirmed: number; unconfirmed: number };
type HistoryItem = { tx_hash: string; height: number; address: string };
type Utxo = { height: number; value: number; address: string; txid: string; vout: number };
type EsploraStatus = { confirmed?: boolean; block_height?: number; block_hash?: string; block_time?: number };
type EsploraTransaction = {
  txid: string; version: number; locktime: number; size: number; weight: number; fee?: number;
  status?: EsploraStatus;
  vin?: Array<{ txid?: string; vout?: number; scriptsig?: string; scriptsig_asm?: string; witness?: string[]; sequence?: number; is_coinbase?: boolean; prevout?: { value?: number; scriptpubkey?: string; scriptpubkey_asm?: string; scriptpubkey_type?: string; scriptpubkey_address?: string } }>;
  vout?: Array<{ value: number; scriptpubkey: string; scriptpubkey_asm?: string; scriptpubkey_type?: string; scriptpubkey_address?: string }>;
};

let connectionState: ConnectionState = 'connecting';
let connectionDisabled = false;
let networkVerified = false;
let connectionPromise: Promise<boolean> | undefined;
let lastRequestAt = 0;
let tipCache: { height: number; time: number } | undefined;
const txHeightCache = new Map<string, number>();
const subscribers = new Set<(state: ConnectionState) => void>();
const controllers = new Set<AbortController>();
const pendingReads = new Map<string, Promise<any>>();
let activeRequests = 0;
const waiters: Array<() => void> = [];

function emitState(state: ConnectionState) {
  connectionState = state;
  for (const listener of subscribers) {
    try { listener(state); } catch (error) { console.warn('[BlueWallet Testnet] status listener failed', error); }
  }
  if (typeof window !== 'undefined') {
    const message = { type: 'blue-network-status', network: TESTNET_NETWORK, backend: 'Blockstream Esplora', state };
    (window as any).__blueNetworkState = message;
    if (window.parent !== window) window.parent.postMessage(message, window.location.origin);
  }
}

function assertAddress(address: string) {
  if (typeof address !== 'string' || !address) throw new Error('A Bitcoin Testnet3 address is required.');
  bitcoin.address.toOutputScript(address);
}

function assertTxid(txid: string) {
  if (!/^[a-f0-9]{64}$/i.test(txid)) throw new Error('Invalid Testnet3 transaction id.');
}

function safeInteger(value: unknown, description: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Invalid ' + description + ' returned by the Testnet3 backend.');
  return parsed;
}

function publishRequestError() {
  if (!connectionDisabled) emitState('disconnected');
}

async function acquireRequestSlot() {
  if (activeRequests >= 4) await new Promise<void>((resolve) => waiters.push(resolve));
  else activeRequests++;
}

function releaseRequestSlot() {
  const next = waiters.shift();
  if (next) next();
  else activeRequests--;
}

async function fetchResponse(path: string, method = 'GET', body?: string): Promise<any> {
  if (connectionDisabled) throw new Error('Bitcoin Testnet3 connection is disabled in BlueWallet settings.');
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid Testnet3 API path.');
  await acquireRequestSlot();
  const controller = new AbortController();
  controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), 20_000);
  lastRequestAt = Date.now();
  try {
    const response = await fetch(TESTNET_API + path, {
      method,
      ...(body === undefined ? {} : { body, headers: { 'Content-Type': 'text/plain' } }),
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error('Blockstream Testnet3 API returned HTTP ' + response.status + ': ' + text.slice(0, 240));
    if (networkVerified) emitState('connected');
    if (response.headers.get('content-type')?.includes('application/json')) return JSON.parse(text);
    return text.trim();
  } catch (error) {
    publishRequestError();
    if (controller.signal.aborted) throw new Error('Blockstream Testnet3 request timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
    controllers.delete(controller);
    releaseRequestSlot();
  }
}

async function request(path: string, method = 'GET', body?: string): Promise<any> {
  const key = method === 'GET' ? path : undefined;
  if (key) {
    const existing = pendingReads.get(key);
    if (existing) return existing;
  }
  const operation = fetchResponse(path, method, body);
  if (!key) return operation;
  pendingReads.set(key, operation);
  try { return await operation; }
  finally { if (pendingReads.get(key) === operation) pendingReads.delete(key); }
}

async function getTip(force = false): Promise<number> {
  if (!force && tipCache && Date.now() - tipCache.time < 30_000) return tipCache.height;
  const height = safeInteger(await request('/blocks/tip/height'), 'Testnet3 block height');
  tipCache = { height, time: Date.now() };
  return height;
}

async function getGenesis(): Promise<string> {
  return String(await request('/block-height/0')).trim().toLowerCase();
}

function esplanadeStats(stats?: { funded_txo_sum?: number; spent_txo_sum?: number }) {
  return safeInteger(stats?.funded_txo_sum ?? 0, 'funded balance') - safeInteger(stats?.spent_txo_sum ?? 0, 'spent balance');
}

export async function getBalanceByAddress(address: string): Promise<Balance> {
  assertAddress(address);
  const stats = await request('/address/' + encodeURIComponent(address));
  return {
    confirmed: esplanadeStats(stats.chain_stats),
    unconfirmed: esplanadeStats(stats.mempool_stats),
  };
}

export async function getTransactionsByAddress(address: string): Promise<HistoryItem[]> {
  assertAddress(address);
  const prefix = '/address/' + encodeURIComponent(address) + '/txs';
  const firstPage: EsploraTransaction[] = await request(prefix);
  const result = [...firstPage];
  let confirmed = firstPage.filter((tx) => tx.status?.confirmed);
  while (confirmed.length === 25) {
    const last = confirmed[confirmed.length - 1].txid;
    const page: EsploraTransaction[] = await request(prefix + '/chain/' + encodeURIComponent(last));
    if (!page.length || page.some((tx) => tx.txid === last)) break;
    result.push(...page);
    confirmed = page;
  }
  return result.map((tx) => {
    const height = tx.status?.confirmed ? safeInteger(tx.status.block_height, 'confirmation height') : 0;
    if (height) txHeightCache.set(tx.txid, height);
    return { tx_hash: tx.txid, height, address };
  });
}

export async function getMempoolTransactionsByAddress(address: string) {
  assertAddress(address);
  const txs: EsploraTransaction[] = await request('/address/' + encodeURIComponent(address) + '/txs/mempool');
  return txs.map((tx) => ({ height: 0 as const, tx_hash: tx.txid, fee: safeInteger(tx.fee ?? 0, 'mempool fee') }));
}

export async function multiGetBalanceByAddress(addresses: string[], _batchsize = 200) {
  const entries = await Promise.all(addresses.map(async (address) => [address, await getBalanceByAddress(address)] as const));
  const result = { balance: 0, unconfirmed_balance: 0, addresses: {} as Record<string, Balance> };
  for (const [address, balance] of entries) {
    result.balance += balance.confirmed;
    result.unconfirmed_balance += balance.unconfirmed;
    result.addresses[address] = balance;
  }
  return result;
}

export async function multiGetUtxoByAddress(addresses: string[], _batchsize = 100) {
  const result: Record<string, Utxo[]> = {};
  await Promise.all(addresses.map(async (address) => {
    assertAddress(address);
    const utxos: Array<{ txid: string; vout: number; value: number; status?: EsploraStatus }> =
      await request('/address/' + encodeURIComponent(address) + '/utxo');
    result[address] = utxos.map((utxo) => ({
      height: utxo.status?.confirmed ? safeInteger(utxo.status.block_height, 'UTXO confirmation height') : 0,
      value: safeInteger(utxo.value, 'UTXO value'),
      address,
      txid: utxo.txid,
      vout: safeInteger(utxo.vout, 'UTXO output index'),
    }));
  }));
  return result;
}

export async function multiGetHistoryByAddress(addresses: string[], _batchsize = 100) {
  const result: Record<string, HistoryItem[]> = {};
  await Promise.all(addresses.map(async (address) => { result[address] = await getTransactionsByAddress(address); }));
  return result;
}

function outputType(value?: string) {
  return ({
    p2pkh: 'pubkeyhash',
    p2sh: 'scripthash',
    v0_p2wpkh: 'witness_v0_keyhash',
    v0_p2wsh: 'witness_v0_scripthash',
    v1_p2tr: 'witness_v1_taproot',
    op_return: 'nulldata',
  } as Record<string, string>)[value || ''] || value || 'unknown';
}

function mapVerboseTransaction(tx: EsploraTransaction, txhex: string, tip: number) {
  const parsed = Transaction.fromHex(txhex);
  if (parsed.getId() !== tx.txid) throw new Error('Blockstream Testnet3 returned a transaction whose id does not match the requested id.');
  const status = tx.status || {};
  const height = status.confirmed ? safeInteger(status.block_height, 'confirmation height') : 0;
  if (height) txHeightCache.set(tx.txid, height);
  const confirmations = height ? Math.max(1, tip - height + 1) : 0;
  return {
    txid: tx.txid,
    hash: tx.txid,
    version: Number(tx.version),
    size: safeInteger(tx.size, 'transaction size'),
    vsize: Math.ceil(safeInteger(tx.weight, 'transaction weight') / 4),
    weight: safeInteger(tx.weight, 'transaction weight'),
    locktime: safeInteger(tx.locktime, 'transaction locktime'),
    fee: safeInteger(tx.fee ?? 0, 'transaction fee'),
    vin: (tx.vin || []).map((input) => ({
      txid: input.txid || '',
      vout: Number(input.vout ?? 0),
      scriptSig: { asm: input.scriptsig_asm || '', hex: input.scriptsig || '' },
      txinwitness: input.witness || [],
      sequence: Number(input.sequence ?? 0),
      ...(input.prevout ? {
        addresses: input.prevout.scriptpubkey_address ? [input.prevout.scriptpubkey_address] : [],
        value: Number(input.prevout.value ?? 0) / 100_000_000,
      } : {}),
    })),
    vout: (tx.vout || []).map((output, n) => ({
      value: Number(output.value) / 100_000_000,
      n,
      addresses: output.scriptpubkey_address ? [output.scriptpubkey_address] : [],
      scriptPubKey: {
        asm: output.scriptpubkey_asm || '',
        hex: output.scriptpubkey,
        reqSigs: 1,
        type: outputType(output.scriptpubkey_type),
        addresses: output.scriptpubkey_address ? [output.scriptpubkey_address] : [],
        ...(output.scriptpubkey_address ? { address: output.scriptpubkey_address } : {}),
      },
    })),
    ...(height ? { blockhash: status.block_hash, confirmations, time: status.block_time, blocktime: status.block_time } : { confirmations: 0, time: 0, blocktime: 0 }),
    hex: txhex,
  };
}

async function getTransactionVerbose(txid: string) {
  assertTxid(txid);
  const [details, txhex] = await Promise.all([
    request('/tx/' + txid),
    request('/tx/' + txid + '/hex'),
  ]);
  const tip = details.status?.confirmed ? await getTip() : 0;
  return mapVerboseTransaction(details, String(txhex), tip);
}

export async function getTransactionsFullByAddress(address: string) {
  const history = await getTransactionsByAddress(address);
  return Promise.all(history.map(async (item) => {
    const tx: any = await getTransactionVerbose(item.tx_hash);
    for (const input of tx.vin) {
      const source = input.txid ? await getTransactionVerbose(input.txid) : undefined;
      const prevout = source?.vout?.[input.vout];
      if (prevout) {
        input.value = prevout.value;
        input.addresses = prevout.scriptPubKey.addresses;
      }
    }
    for (const output of tx.vout) {
      output.addresses = output.scriptPubKey.addresses;
    }
    tx.inputs = tx.vin;
    tx.outputs = tx.vout;
    delete tx.vin;
    delete tx.vout;
    delete tx.hex;
    delete tx.hash;
    tx.address = address;
    return tx;
  }));
}

export async function multiGetTransactionByTxid(txids: string[], verbose: boolean, _batchsize = 45) {
  const unique = [...new Set(txids.filter((txid) => !!txid))];
  const entries = await Promise.all(unique.map(async (txid) => {
    assertTxid(txid);
    if (!verbose) {
      const txhex = String(await request('/tx/' + txid + '/hex'));
      if (Transaction.fromHex(txhex).getId() !== txid) throw new Error('Blockstream Testnet3 returned an unexpected transaction id.');
      return [txid, txhex] as const;
    }
    const tx: any = await getTransactionVerbose(txid);
    delete tx.hex;
    delete tx.hash;
    return [txid, tx] as const;
  }));
  return Object.fromEntries(entries);
}

export function calcEstimateFeeFromFeeHistorgam(numberOfBlocks: number, histogram: number[][]) {
  let accumulatedVsize = 0;
  const targetVsize = Math.max(1, numberOfBlocks) * 1_000_000;
  for (const [feeRate, vsize] of histogram) {
    accumulatedVsize += Number(vsize) || 0;
    if (accumulatedVsize >= targetVsize) return Math.max(1, Math.round(Number(feeRate) || 1));
  }
  return Math.max(1, Math.round(Number(histogram[histogram.length - 1]?.[0]) || 1));
}

async function estimateForTarget(target: number) {
  const estimates: Record<string, number> = await request('/fee-estimates');
  const targets = Object.keys(estimates).map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!targets.length) throw new Error('Blockstream Testnet3 fee estimates are unavailable.');
  const selected = targets.find((value) => value >= Math.max(1, target)) ?? targets[targets.length - 1];
  const feeRate = Number(estimates[String(selected)]);
  if (!Number.isFinite(feeRate) || feeRate <= 0) throw new Error('Blockstream returned an invalid Testnet3 fee estimate.');
  return Math.max(1, Math.ceil(feeRate));
}

export async function estimateFees() {
  const [fast, medium, slow] = await Promise.all([estimateForTarget(1), estimateForTarget(6), estimateForTarget(24)]);
  return { fast, medium, slow };
}

export async function estimateFee(numberOfBlocks: number) {
  return estimateForTarget(numberOfBlocks || 1);
}

export async function serverFeatures() {
  const genesis = await getGenesis();
  if (genesis !== TESTNET_GENESIS) throw new Error('The public Esplora endpoint did not identify Bitcoin Testnet3.');
  networkVerified = true;
  emitState('connected');
  return { genesis_hash: genesis, hash_function: 'sha256', network: TESTNET_NETWORK, server_version: 'Blockstream Esplora HTTPS' };
}

export async function broadcastV2(txhex: string): Promise<string> {
  if (connectionDisabled) throw new Error('Bitcoin Testnet3 connection is disabled in BlueWallet settings.');
  let tx: Transaction;
  try { tx = Transaction.fromHex(txhex); }
  catch { throw new Error('Invalid serialized Bitcoin Testnet3 transaction.'); }
  if (!tx.ins.length || !tx.outs.length) throw new Error('Cannot broadcast an empty Bitcoin transaction.');
  const expected = tx.getId();
  const returned = String(await request('/tx', 'POST', txhex)).trim().toLowerCase();
  if (returned !== expected.toLowerCase()) throw new Error('Blockstream returned a different Testnet3 transaction id.');
  return returned;
}

export async function broadcast(txhex: string) {
  try { return await broadcastV2(txhex); }
  catch (error) { return error; }
}

export async function getCurrentBlockTip() {
  return getTip();
}

export async function getConfirmedBlockHeight(txid: string) {
  assertTxid(txid);
  const tip = await getTip();
  let height = txHeightCache.get(txid);
  if (!height) {
    const details: EsploraTransaction = await request('/tx/' + txid);
    if (!details.status?.confirmed) return null;
    height = safeInteger(details.status.block_height, 'confirmation height');
    txHeightCache.set(txid, height);
  }
  return height > 0 && height <= tip ? { height, tip } : null;
}

export async function getBlockTimestamps(heights: number[]) {
  const result: Record<number, number> = {};
  await Promise.all(heights.map(async (height) => {
    const safeHeight = safeInteger(height, 'block height');
    const hash = String(await request('/block-height/' + safeHeight));
    const block = await request('/block/' + encodeURIComponent(hash));
    result[safeHeight] = safeInteger(block.timestamp, 'block timestamp');
  }));
  return result;
}

export function estimateCurrentBlockheight() {
  if (!tipCache) return 0;
  return tipCache.height + Math.max(0, Math.floor((Date.now() - tipCache.time) / 600_000));
}

export function calculateBlockTime(height: number) {
  if (!tipCache || !Number.isFinite(height)) return 0;
  return Math.floor(Date.now() / 1000) + (height - tipCache.height) * 600;
}

export async function getConfig() {
  return {
    host: TESTNET_HOST,
    port: 443,
    serverName: 'Blockstream Esplora Testnet3',
    connected: connectionState === 'connected' ? 1 : 0,
  };
}

export function getSecondsSinceLastRequest() {
  return lastRequestAt ? (Date.now() - lastRequestAt) / 1000 : -1;
}

export async function getPreferredServer() {
  return { host: TESTNET_HOST, ssl: 443, name: 'Blockstream Esplora Testnet3' };
}

export async function removePreferredServer() {}
export async function isDisabled() { return connectionDisabled; }
export async function setDisabled(disabled = true) {
  connectionDisabled = Boolean(disabled);
  if (connectionDisabled) {
    for (const controller of controllers) controller.abort();
    emitState('disabled');
  } else {
    emitState('connecting');
    await connectMain();
  }
}

export async function ensureConnected() {
  if (connectionDisabled) return false;
  return connectMain();
}

export async function connectMain() {
  if (connectionDisabled) { emitState('disabled'); return false; }
  if (connectionPromise) return connectionPromise;
  emitState('connecting');
  connectionPromise = (async () => {
    try {
      const genesis = await getGenesis();
      if (genesis !== TESTNET_GENESIS) throw new Error('The public Esplora endpoint did not identify Bitcoin Testnet3.');
      networkVerified = true;
      await getTip();
      emitState('connected');
      return true;
    } catch (error) {
      console.warn('[BlueWallet Testnet3] connection failed', error);
      emitState('disconnected');
      return false;
    }
  })();
  try { return await connectionPromise; }
  finally { connectionPromise = undefined; }
}

export async function waitTillConnected() {
  return ensureConnected();
}

export async function ping() {
  if (connectionDisabled) return false;
  if (!networkVerified) return connectMain();
  try { await getTip(true); emitState('connected'); return true; }
  catch { emitState('disconnected'); return false; }
}

export async function testConnection(host: string, tcpPort?: number | false, sslPort?: number | false) {
  const normalizedHost = String(host).toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (![TESTNET_HOST, TESTNET_HOST + '/testnet/api'].includes(normalizedHost)) return false;
  if (Number(sslPort || tcpPort) !== 443) return false;
  return ping();
}

export async function presentResetToDefaultsAlert() { return false; }
export async function presentElectrumDisconnectedHelpAlert() {}
export function getServerBanner() { return Promise.resolve('Blockstream Esplora HTTPS · Bitcoin Testnet3'); }
export function getConnectionState(): ConnectionState { return connectionState; }
export function subscribeConnectionState(listener: (state: ConnectionState) => void) {
  subscribers.add(listener);
  listener(connectionState);
  return () => subscribers.delete(listener);
}
export function isConnected() { return connectionState === 'connected'; }
export function forceDisconnect() {
  for (const controller of controllers) controller.abort();
  emitState(connectionDisabled ? 'disabled' : 'disconnected');
}
export function setBatchingDisabled() {}
export function setBatchingEnabled() {}

if (typeof window !== 'undefined') {
  emitState(connectionState);
  setTimeout(() => { void ensureConnected(); }, 0);
}
