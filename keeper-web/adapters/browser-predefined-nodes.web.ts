import type { NodeDetail } from 'src/services/wallets/interfaces';
import { NetworkType } from 'src/services/wallets/enums';
import { TESTNET_NODE_HOST } from './browser-electrum-transport.web';

export const predefinedTestnetNodes: NodeDetail[] = [{
  id: 336, host: TESTNET_NODE_HOST, port: '443', isConnected: true,
  useKeeperNode: false, useSSL: true, networkType: NetworkType.TESTNET,
}];

// This educational simulator never connects to a mainnet backend.
export const predefinedMainnetNodes: NodeDetail[] = [];
