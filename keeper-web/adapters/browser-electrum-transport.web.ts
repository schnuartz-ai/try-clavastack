import { Transaction } from 'bitcoinjs-lib';

export const TESTNET_API = 'https://mempool.space/testnet4/api';
export const TESTNET_NODE_HOST = 'mempool.space/testnet4/api';

/**
 * Adapt the electrum-client transport interface, keeping Keeper's original
 * ElectrumClient, wallet sync, coin selection and transaction logic intact.
 * Every balance, history, fee and transaction response comes from Esplora.
 * API reference: https://github.com/Blockstream/esplora/blob/master/API.md
 */
export default class BrowserElectrumTransport {
  onError?: (error: Error) => void;
  private host: string;
  private closed = false;
  private controllers = new Set<AbortController>();
  private activeRequests = 0;
  private waiters: Array<() => void> = [];
  private pendingReads = new Map<string, Promise<any>>();

  constructor(_net: unknown, _tls: unknown, _port: unknown, host: string, _protocol: unknown) {
    this.host = host;
  }

  private async request(path: string, body?: string): Promise<any> {
    if (this.closed) throw new Error('Bitcoin HTTPS connection is closed.');
    if (this.host !== TESTNET_NODE_HOST) {
      throw new Error('This browser simulator uses the Testnet4 HTTPS backend. Native TCP/TLS nodes are unavailable.');
    }
    // Keeper scans address gaps in batches. Limit HTTP concurrency, and merge
    // identical in-flight reads without caching stale balances or confirmations.
    const existing = body === undefined ? this.pendingReads.get(path) : undefined;
    if (existing) return existing;
    const operation = this.fetchResponse(path, body);
    if (body !== undefined) return operation;
    this.pendingReads.set(path, operation);
    try { return await operation; }
    finally { if (this.pendingReads.get(path) === operation) this.pendingReads.delete(path); }
  }

  private async fetchResponse(path: string, body?: string): Promise<any> {
    if (this.activeRequests >= 4) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.activeRequests++;
    const NativeAbortController = (globalThis as any).__keeperNativeAbortController || globalThis.AbortController;
    const controller: AbortController = new NativeAbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      if (this.closed) throw new Error('Bitcoin HTTPS connection is closed.');
      // RN replaces global fetch during boot. Use the saved browser fetch to
      // avoid routing this HTTP transport back through native XMLHttpRequest.
      const browserFetch = (globalThis as any).__keeperNativeFetch || globalThis.fetch;
      const response = await browserFetch(`${TESTNET_API}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { body, headers: { 'Content-Type': 'text/plain' } }),
        credentials: 'omit', signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Testnet4 backend (${response.status}): ${text.slice(0, 240)}`);
      if (response.headers.get('content-type')?.includes('application/json')) return JSON.parse(text);
      return text.trim();
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
      const next = this.waiters.shift();
      if (next) next(); // Transfer the reserved slot to the next waiting read.
      else this.activeRequests--;
    }
  }

  async initElectrum(_options: unknown) {
    await this.height();
    return ['Keeper browser HTTPS / Esplora', '1.4'];
  }

  close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
  }

  private async height() {
    const height = Number(await this.request('/blocks/tip/height'));
    if (!Number.isSafeInteger(height) || height < 0) throw new Error('Invalid Testnet4 block height.');
    return height;
  }

  async server_ping() { await this.height(); }

  async server_features() {
    return {
      genesis_hash: await this.request('/block-height/0'),
      hash_function: 'sha256', transport: 'https', network: 'testnet4',
    };
  }

  async blockchainHeaders_subscribe() {
    const height = await this.height();
    const hash = await this.request(`/block-height/${height}`);
    return { height, hex: await this.request(`/block/${hash}/header`) };
  }

  private scriptHash(hash: string) {
    if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('Invalid script hash.');
    // Electrum sends SHA256(script) in reverse byte order; Esplora's REST
    // endpoint uses the digest's forward byte order.
    return Buffer.from(hash, 'hex').reverse().toString('hex');
  }

  async blockchainScripthash_listunspentBatch(hashes: string[]) {
    return Promise.all(hashes.map(async (param) => {
      const utxos = await this.request(`/scripthash/${this.scriptHash(param)}/utxo`);
      return {
        param, result: utxos.map((utxo: any) => ({
          tx_hash: utxo.txid, tx_pos: utxo.vout, value: utxo.value,
          height: utxo.status.confirmed ? utxo.status.block_height : 0,
        })),
      };
    }));
  }

  async blockchainScripthash_getHistoryBatch(hashes: string[]) {
    return Promise.all(hashes.map(async (param) => {
      const prefix = `/scripthash/${this.scriptHash(param)}/txs`;
      const transactions = await this.request(prefix);
      let confirmed = transactions.filter((tx: any) => tx.status.confirmed);
      // Esplora's initial response contains only 25 confirmed transactions.
      // Keep paging so Keeper's recovery/address discovery sees the full history.
      while (confirmed.length === 25) {
        const last = confirmed[confirmed.length - 1].txid;
        confirmed = await this.request(`${prefix}/chain/${last}`);
        if (confirmed.some((tx: any) => tx.txid === last)) throw new Error('Testnet4 history pagination did not advance.');
        transactions.push(...confirmed);
      }
      return {
        param, result: transactions.map((tx: any) => ({
          tx_hash: tx.txid, height: tx.status.confirmed ? tx.status.block_height : 0,
        })),
      };
    }));
  }

  async blockchainTransaction_getBatch(txids: string[], verbose = true) {
    const height = verbose ? await this.height() : 0;
    return Promise.all(txids.map(async (param) => {
      if (!/^[0-9a-f]{64}$/i.test(param)) throw new Error('Invalid transaction id.');
      const hex = await this.request(`/tx/${param}/hex`);
      const parsed = Transaction.fromHex(hex);
      if (parsed.getId() !== param) throw new Error('Testnet4 backend returned a different transaction.');
      if (!verbose) return { param, result: hex };
      const tx = await this.request(`/tx/${param}`);
      return {
        param, result: {
          txid: param, hash: Buffer.from(parsed.getHash(true)).reverse().toString('hex'), hex,
          version: tx.version, locktime: tx.locktime, size: tx.size, weight: tx.weight,
          vsize: Math.ceil(tx.weight / 4),
          confirmations: tx.status.confirmed ? Math.max(0, height - tx.status.block_height + 1) : 0,
          blockhash: tx.status.block_hash, time: tx.status.block_time, blocktime: tx.status.block_time,
          vin: tx.vin.map((input: any) => ({
            ...(input.is_coinbase ? { coinbase: input.scriptsig } : { txid: input.txid, vout: input.vout }),
            scriptSig: { asm: input.scriptsig_asm, hex: input.scriptsig },
            txinwitness: input.witness || [], sequence: input.sequence,
            ...(input.prevout ? {
              addresses: input.prevout.scriptpubkey_address ? [input.prevout.scriptpubkey_address] : [],
              value: input.prevout.value / 1e8,
            } : {}),
          })),
          vout: tx.vout.map((output: any, n: number) => ({
            n, value: output.value / 1e8,
            scriptPubKey: {
              asm: output.scriptpubkey_asm, hex: output.scriptpubkey,
              type: output.scriptpubkey_type, address: output.scriptpubkey_address,
              addresses: output.scriptpubkey_address ? [output.scriptpubkey_address] : [],
            },
          })),
        },
      };
    }));
  }

  async blockchainEstimatefee(target: number) {
    const estimates = await this.request('/fee-estimates');
    const available = Object.keys(estimates).map(Number).sort((a, b) => a - b);
    const fee = Number(estimates[available.find((blocks) => blocks >= target) ?? available[available.length - 1]]);
    if (!Number.isFinite(fee) || fee < 0) throw new Error('Invalid Testnet4 fee estimate.');
    // Keeper's native client converts BTC/kB using 1024 bytes per kB.
    return fee * 1024 / 1e8;
  }

  async blockchainTransaction_broadcast(hex: string) {
    // Reject malformed transactions before sending.
    const expected = Transaction.fromHex(hex).getId();
    const txid = await this.request('/tx', hex);
    if (txid !== expected) throw new Error('Testnet4 backend returned an unexpected broadcast transaction id.');
    return txid;
  }
}
