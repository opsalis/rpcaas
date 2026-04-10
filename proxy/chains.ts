/**
 * Chain configuration for RPCaaS proxy.
 * Each chain defines its internal k8s service endpoints, chain ID, and aliases.
 */

export interface ChainConfig {
  /** Canonical chain name */
  name: string;
  /** EIP-155 chain ID */
  chainId: number;
  /** Internal RPC endpoints (k8s ClusterIP services) */
  endpoints: string[];
  /** URL aliases that map to this chain */
  aliases: string[];
  /** RPC port on the node */
  rpcPort: number;
  /** Whether WebSocket is supported */
  wsSupported: boolean;
  /** WebSocket port (if different from RPC) */
  wsPort?: number;
}

export const CHAINS: Record<string, ChainConfig> = {
  base: {
    name: 'Base',
    chainId: 8453,
    endpoints: [process.env.BASE_RPC_URL || 'http://base-node:8545'],
    aliases: ['base', 'base-mainnet', '8453'],
    rpcPort: 8545,
    wsSupported: true,
    wsPort: 8546,
  },
  optimism: {
    name: 'Optimism',
    chainId: 10,
    endpoints: [process.env.OPTIMISM_RPC_URL || 'http://optimism-node:8545'],
    aliases: ['optimism', 'op', 'op-mainnet', '10'],
    rpcPort: 8545,
    wsSupported: true,
    wsPort: 8546,
  },
  arbitrum: {
    name: 'Arbitrum One',
    chainId: 42161,
    endpoints: [process.env.ARBITRUM_RPC_URL || 'http://arbitrum-node:8547'],
    aliases: ['arbitrum', 'arb', 'arbitrum-one', '42161'],
    rpcPort: 8547,
    wsSupported: true,
    wsPort: 8548,
  },
  polygon: {
    name: 'Polygon PoS',
    chainId: 137,
    endpoints: [process.env.POLYGON_RPC_URL || 'http://polygon-node:8545'],
    aliases: ['polygon', 'matic', 'polygon-pos', '137'],
    rpcPort: 8545,
    wsSupported: true,
    wsPort: 8546,
  },
  ethereum: {
    name: 'Ethereum',
    chainId: 1,
    endpoints: [process.env.ETHEREUM_RPC_URL || 'http://ethereum-node:8545'],
    aliases: ['ethereum', 'eth', 'mainnet', '1'],
    rpcPort: 8545,
    wsSupported: true,
    wsPort: 8546,
  },
};

/** Map of all aliases to canonical chain names */
const aliasMap = new Map<string, string>();
for (const [canonical, config] of Object.entries(CHAINS)) {
  for (const alias of config.aliases) {
    aliasMap.set(alias.toLowerCase(), canonical);
  }
}

/**
 * Resolve a chain alias (name, short name, or chain ID) to canonical chain name.
 * Returns undefined if the alias is not recognized.
 */
export function resolveChain(alias: string): string | undefined {
  return aliasMap.get(alias.toLowerCase());
}

/**
 * Get the RPC endpoint for a canonical chain name.
 * Returns the first healthy endpoint (future: load balancing).
 */
export function getEndpoint(chain: string): string | undefined {
  const config = CHAINS[chain];
  if (!config || config.endpoints.length === 0) return undefined;
  // Simple round-robin or first-available (for now: first)
  return config.endpoints[0];
}

/**
 * Get chain config by canonical name.
 */
export function getChainConfig(chain: string): ChainConfig | undefined {
  return CHAINS[chain];
}

/**
 * List all supported chain names.
 */
export function listChains(): string[] {
  return Object.keys(CHAINS);
}
