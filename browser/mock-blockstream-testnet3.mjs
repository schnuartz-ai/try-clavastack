import { Transaction } from 'bitcoinjs-lib';

export const TESTNET3_GENESIS = '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943';

export async function mockBlockstreamTestnet3(page) {
  await page.route('https://blockstream.info/testnet/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const path = pathname.slice('/testnet/api'.length);
    if (route.request().method() === 'POST') {
      if (path !== '/tx') return route.fulfill({ status: 404, body: 'Unsupported Testnet3 POST.' });
      const transaction = Transaction.fromHex(route.request().postData() || '');
      return route.fulfill({ status: 200, contentType: 'text/plain',
        headers: { 'access-control-allow-origin': '*' }, body: transaction.getId() });
    }
    let body;
    let contentType = 'application/json';
    if (path === '/blocks/tip/height') {
      body = '5157049';
      contentType = 'text/plain';
    } else if (path === '/block-height/0') {
      body = TESTNET3_GENESIS;
      contentType = 'text/plain';
    } else if (path === '/fee-estimates') {
      body = JSON.stringify({ 1: 2, 6: 1, 24: 1 });
    } else if (path.endsWith('/utxo') || path.includes('/txs')) {
      body = '[]';
    } else if (path.startsWith('/address/')) {
      body = JSON.stringify({
        chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
      });
    } else {
      body = '[]';
    }
    await route.fulfill({
      status: 200,
      contentType,
      headers: { 'access-control-allow-origin': '*' },
      body,
    });
  });
}
