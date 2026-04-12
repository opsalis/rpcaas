/**
 * Chain configuration for ChainRPC — all supported blockchains.
 *
 * Hostname-based routing: each chain gets its own FQDN (ethereum.chainrpc.net).
 * The proxy reads req.hostname to determine the target chain.
 *
 * Upstream endpoints: multiple free public RPCs per chain with failover.
 * For our own chains (L1/L2/demo), endpoints point to our own infrastructure.
 */

export interface ChainConfig {
  name: string;
  chainId: number;
  subdomain: string;
  endpoints: string[];
  wsEndpoints?: string[];
  explorerTx?: string;
  explorerBlock?: string;
  explorerAddress?: string;
  isOwn: boolean;
  gasToken: string;
  blockTimeSec: number;
}

export const CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    name: 'Ethereum',
    chainId: 1,
    subdomain: 'ethereum',
    endpoints: [
      'https://ethereum-rpc.publicnode.com',
      'https://eth.drpc.org',
      'https://eth.llamarpc.com',
      'https://1rpc.io/eth',
    ],
    wsEndpoints: ['wss://ethereum-rpc.publicnode.com'],
    explorerTx: 'https://etherscan.io/tx/{hash}',
    explorerBlock: 'https://etherscan.io/block/{hash}',
    explorerAddress: 'https://etherscan.io/address/{hash}',
    isOwn: false,
    gasToken: 'ETH',
    blockTimeSec: 12,
  },
  base: {
    name: 'Base',
    chainId: 8453,
    subdomain: 'base',
    endpoints: [
      'https://base-rpc.publicnode.com',
      'https://base.drpc.org',
      'https://base.meowrpc.com',
      'https://base.gateway.tenderly.co',
      'https://mainnet.base.org',
    ],
    wsEndpoints: ['wss://base-rpc.publicnode.com'],
    explorerTx: 'https://basescan.org/tx/{hash}',
    explorerBlock: 'https://basescan.org/block/{hash}',
    explorerAddress: 'https://basescan.org/address/{hash}',
    isOwn: false,
    gasToken: 'ETH',
    blockTimeSec: 2,
  },
  arbitrum: {
    name: 'Arbitrum One',
    chainId: 42161,
    subdomain: 'arbitrum',
    endpoints: [
      'https://arbitrum-one-rpc.publicnode.com',
      'https://arb1.arbitrum.io/rpc',
      'https://1rpc.io/arb',
    ],
    wsEndpoints: ['wss://arbitrum-one-rpc.publicnode.com'],
    explorerTx: 'https://arbiscan.io/tx/{hash}',
    explorerBlock: 'https://arbiscan.io/block/{hash}',
    explorerAddress: 'https://arbiscan.io/address/{hash}',
    isOwn: false,
    gasToken: 'ETH',
    blockTimeSec: 0.25,
  },
  optimism: {
    name: 'Optimism',
    chainId: 10,
    subdomain: 'optimism',
    endpoints: [
      'https://optimism-rpc.publicnode.com',
      'https://mainnet.optimism.io',
      'https://1rpc.io/op',
    ],
    wsEndpoints: ['wss://optimism-rpc.publicnode.com'],
    explorerTx: 'https://optimistic.etherscan.io/tx/{hash}',
    explorerBlock: 'https://optimistic.etherscan.io/block/{hash}',
    explorerAddress: 'https://optimistic.etherscan.io/address/{hash}',
    isOwn: false,
    gasToken: 'ETH',
    blockTimeSec: 2,
  },
  polygon: {
    name: 'Polygon PoS',
    chainId: 137,
    subdomain: 'polygon',
    endpoints: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://polygon-rpc.com',
      'https://1rpc.io/matic',
    ],
    wsEndpoints: ['wss://polygon-bor-rpc.publicnode.com'],
    explorerTx: 'https://polygonscan.com/tx/{hash}',
    explorerBlock: 'https://polygonscan.com/block/{hash}',
    explorerAddress: 'https://polygonscan.com/address/{hash}',
    isOwn: false,
    gasToken: 'POL',
    blockTimeSec: 2,
  },
  bsc: {
    name: 'BNB Chain',
    chainId: 56,
    subdomain: 'bsc',
    endpoints: [
      'https://bsc-rpc.publicnode.com',
      'https://bsc-dataseed.binance.org',
      'https://1rpc.io/bnb',
    ],
    wsEndpoints: ['wss://bsc-rpc.publicnode.com'],
    explorerTx: 'https://bscscan.com/tx/{hash}',
    explorerBlock: 'https://bscscan.com/block/{hash}',
    explorerAddress: 'https://bscscan.com/address/{hash}',
    isOwn: false,
    gasToken: 'BNB',
    blockTimeSec: 3,
  },
  avalanche: {
    name: 'Avalanche C-Chain',
    chainId: 43114,
    subdomain: 'avalanche',
    endpoints: [
      'https://avalanche-c-chain-rpc.publicnode.com',
      'https://api.avax.network/ext/bc/C/rpc',
      'https://1rpc.io/avax/c',
    ],
    wsEndpoints: ['wss://avalanche-c-chain-rpc.publicnode.com'],
    explorerTx: 'https://snowtrace.io/tx/{hash}',
    explorerBlock: 'https://snowtrace.io/block/{hash}',
    explorerAddress: 'https://snowtrace.io/address/{hash}',
    isOwn: false,
    gasToken: 'AVAX',
    blockTimeSec: 2,
  },
  gnosis: {
    name: 'Gnosis Chain',
    chainId: 100,
    subdomain: 'gnosis',
    endpoints: [
      'https://gnosis-rpc.publicnode.com',
      'https://rpc.gnosischain.com',
    ],
    wsEndpoints: ['wss://gnosis-rpc.publicnode.com'],
    explorerTx: 'https://gnosisscan.io/tx/{hash}',
    explorerBlock: 'https://gnosisscan.io/block/{hash}',
    explorerAddress: 'https://gnosisscan.io/address/{hash}',
    isOwn: false,
    gasToken: 'xDAI',
    blockTimeSec: 5,
  },
  sepolia: {
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    subdomain: 'sepolia',
    endpoints: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://1rpc.io/sepolia',
    ],
    wsEndpoints: ['wss://ethereum-sepolia-rpc.publicnode.com'],
    explorerTx: 'https://sepolia.etherscan.io/tx/{hash}',
    explorerBlock: 'https://sepolia.etherscan.io/block/{hash}',
    explorerAddress: 'https://sepolia.etherscan.io/address/{hash}',
    isOwn: false,
    gasToken: 'ETH',
    blockTimeSec: 12,
  },
  'base-sepolia': {
    name: 'Base Sepolia',
    chainId: 84532,
    subdomain: 'base-sepolia',
    endpoints: [
      'https://base-sepolia-rpc.publicnode.com',
      'https://base-sepolia.drpc.org',
      'https://sepolia.base.org',
    ],
    wsEndpoints: ['wss://base-sepolia-rpc.publicnode.com'],
    explorerTx: 'https://sepolia.basescan.org/tx/{hash}',
    explorerBlock: 'https://sepolia.basescan.org/block/{hash}',
    explorerAddress: 'https://sepolia.basescan.org/address/{hash}',
    isOwn: false,
    gasToken: 'ETH',
    blockTimeSec: 2,
  },
  'sertone-l1': {
    name: 'Sertone L1',
    chainId: 845300,
    subdomain: 'l1',
    endpoints: [
      process.env.L1_RPC_1 || 'http://node1.zone2serve.top:8545',
      process.env.L1_RPC_2 || 'http://node2.zone2serve.top:8545',
      process.env.L1_RPC_3 || 'http://node3.zone2serve.top:8545',
      process.env.L1_RPC_4 || 'http://node4.zone2serve.top:8545',
      process.env.L1_RPC_5 || 'http://node6.zone2serve.top:8545',
    ],
    explorerTx: 'https://explorer.l2aas.net/tx/{hash}',
    explorerBlock: 'https://explorer.l2aas.net/block/{hash}',
    explorerAddress: 'https://explorer.l2aas.net/address/{hash}',
    isOwn: true,
    gasToken: 'OPSGAS',
    blockTimeSec: 6,
  },
  'sertone-l2': {
    name: 'Sertone L2',
    chainId: 845301,
    subdomain: 'l2',
    endpoints: [
      process.env.L2_RPC_1 || 'http://l2node2.zone2serve.top:8545',
      process.env.L2_RPC_2 || 'http://l2node1.zone2serve.top:8545',
    ],
    explorerTx: 'https://explorer.l2aas.net/tx/{hash}',
    explorerBlock: 'https://explorer.l2aas.net/block/{hash}',
    explorerAddress: 'https://explorer.l2aas.net/address/{hash}',
    isOwn: true,
    gasToken: 'OPSGAS',
    blockTimeSec: 2,
  },
  'sertone-demo': {
    name: 'Sertone Demo',
    chainId: 845302,
    subdomain: 'demo',
    endpoints: [
      process.env.DEMO_L2_RPC || 'http://demo-l2-geth:8545',
    ],
    explorerTx: 'https://explorer.l2aas.net/demo/tx/{hash}',
    explorerBlock: 'https://explorer.l2aas.net/demo/block/{hash}',
    explorerAddress: 'https://explorer.l2aas.net/demo/address/{hash}',
    isOwn: true,
    gasToken: 'DEMO',
    blockTimeSec: 2,
  },
};

const DOMAIN = process.env.CHAINRPC_DOMAIN || 'chainrpc.net';

const hostnameMap = new Map<string, string>();
const aliasMap = new Map<string, string>();

for (const [canonical, config] of Object.entries(CHAINS)) {
  hostnameMap.set(`${config.subdomain}.${DOMAIN}`, canonical);
  aliasMap.set(config.subdomain, canonical);
  aliasMap.set(canonical, canonical);
  aliasMap.set(String(config.chainId), canonical);
}

export function resolveFromHostname(hostname: string): string | undefined {
  return hostnameMap.get(hostname.toLowerCase());
}

export function resolveChain(alias: string): string | undefined {
  return aliasMap.get(alias.toLowerCase());
}

const endpointCounters = new Map<string, number>();

export function getEndpoint(chain: string): string | undefined {
  const config = CHAINS[chain];
  if (!config || config.endpoints.length === 0) return undefined;
  const counter = (endpointCounters.get(chain) || 0) + 1;
  endpointCounters.set(chain, counter);
  return config.endpoints[counter % config.endpoints.length];
}

export function getChainConfig(chain: string): ChainConfig | undefined {
  return CHAINS[chain];
}

export function listChains(): string[] {
  return Object.keys(CHAINS);
}

export function listPublicChainInfo(): Array<{ id: string; name: string; chainId: number; subdomain: string; fqdn: string; gasToken: string; isOwn: boolean }> {
  return Object.entries(CHAINS).map(([id, c]) => ({
    id,
    name: c.name,
    chainId: c.chainId,
    subdomain: c.subdomain,
    fqdn: `${c.subdomain}.${DOMAIN}`,
    gasToken: c.gasToken,
    isOwn: c.isOwn,
  }));
}
