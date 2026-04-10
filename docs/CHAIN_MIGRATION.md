# Chain Migration

## Product Concept

Chain Migration is a service that reads all contract state from Chain A and writes it to Chain B. It uses RPCaaS full nodes to read source chains, eliminating external RPC dependencies.

This is a separate product that leverages RPCaaS infrastructure. It is documented here because RPCaaS provides the critical read layer.

## How It Works

### Technical Flow

1. **Enumerate contracts**: Identify target contracts on source chain
2. **Read bytecode**: `eth_getCode(address)` for each contract
3. **Read storage**: `eth_getStorageAt(address, slot)` for all storage slots
4. **Read balances**: `eth_getBalance(address)` for relevant accounts
5. **Generate deployment**: Create deploy transactions for destination chain
6. **Deploy to destination**: Execute transactions on destination chain
7. **Verify**: Compare state between source and destination

```
Source Chain (via RPCaaS)           Destination Chain (L2aaS or other)
┌──────────────┐                   ┌──────────────┐
│ Base/OP/Arb  │  eth_getCode()    │              │
│ Polygon/ETH  │ ─────────────────>│  Migration   │
│              │  eth_getStorage() │  Service     │
│              │ ─────────────────>│              │
│              │  eth_getBalance() │              │
│              │ ─────────────────>│  ──deploy──> │ Target L2
└──────────────┘                   └──────────────┘
```

### Detailed Steps

#### Step 1: Contract Discovery
```javascript
// Get contract bytecode
const code = await sourceProvider.getCode(contractAddress);
if (code === '0x') throw new Error('Not a contract');
```

#### Step 2: Storage Enumeration
```javascript
// For known storage layouts (ERC-20, ERC-721, etc.)
// Read specific slots based on the contract's storage layout
const slot0 = await sourceProvider.getStorageAt(address, 0);
const slot1 = await sourceProvider.getStorageAt(address, 1);
// ...

// For unknown layouts: use debug_traceTransaction to discover accessed slots
// (requires archive node or recent transactions)
```

#### Step 3: State Snapshot
```javascript
// Create a state snapshot at a specific block
const blockNumber = await sourceProvider.getBlockNumber();
const snapshot = {
  blockNumber,
  contracts: [{
    address: contractAddress,
    code: await sourceProvider.getCode(contractAddress, blockNumber),
    storage: { /* slot -> value mapping */ },
    balance: await sourceProvider.getBalance(contractAddress, blockNumber),
  }],
};
```

#### Step 4: Deploy to Destination
```javascript
// Deploy each contract to the destination chain
// Note: contract addresses WILL be different on the destination
for (const contract of snapshot.contracts) {
  const tx = await destWallet.sendTransaction({
    data: contract.code,
    value: contract.balance,
  });
  const receipt = await tx.wait();
  addressMap[contract.address] = receipt.contractAddress;
}
```

#### Step 5: Set Storage
```javascript
// Use a helper contract or genesis allocation to set storage slots
// This requires destination chain admin access (only possible on L2aaS chains)
```

## Pricing

### Free Tier: Migrate TO L2aaS
- **Price**: $0
- **Requirement**: Destination must be an L2aaS chain (customer acquisition tool)
- **Limit**: Up to 10 contracts per migration
- **Support**: Self-service via web interface

### Paid Tier: Migrate TO Any EVM Chain
- **Price**: Cost + 500% markup
- **Base cost**: Estimated from gas fees on destination chain
- **Minimum**: $50 per migration
- **Example pricing**:
  - Simple ERC-20 token: ~$50
  - DEX with pools: ~$200-500
  - Complex DeFi protocol: ~$500-2000
- **Payment**: USDC

### Enterprise Tier: Full Protocol Migration
- **Price**: Custom quote
- **Includes**: Contract dependency analysis, storage mapping, verification
- **Support**: Hands-on assistance
- **Timeline**: 1-2 weeks per protocol

## Limitations

### What CAN Be Migrated
- Contract bytecode (exact copy)
- Storage state at a specific block
- Account balances
- Contract-to-contract references (with address remapping)

### What CANNOT Be Migrated
- **Transaction history**: Only current state is copied, not historical transactions
- **Contract addresses**: New deployments get new addresses. All references must be updated.
- **Cross-contract dependencies**: Contracts that reference other contracts by address need those references updated to new addresses. This requires knowing the storage layout.
- **Immutable constructor arguments**: If the contract stores the original chain ID or addresses as immutable, the bytecode itself must be patched (complex, not always possible).
- **External service integrations**: Oracles, bridges, governance contracts that depend on the source chain cannot be migrated.
- **EIP-1967 proxy patterns**: Proxy contracts can be migrated but the admin/implementation slots need careful handling.

### Special Handling Required
- **Token contracts**: Balances mapping must be reconstructed. Need to enumerate all holders (via transfer event logs or known addresses).
- **Governance contracts**: Voting power, delegation, timelock state all need migration.
- **AMM pools**: LP positions, reserves, accumulated fees must all be consistent.
- **NFT contracts**: Token URIs, ownership, approvals all in storage.

## RPCaaS Integration

Chain Migration reads from RPCaaS full nodes, providing:
- **Zero external dependency**: No Alchemy/Infura needed for reads
- **All 5 supported chains**: Migrate from Base, Optimism, Arbitrum, Polygon, or Ethereum
- **Consistent state**: Read at a specific block number for snapshot consistency
- **High throughput**: Internal k8s network, no rate limiting for internal services

### Internal Access (No API Key Needed)
```javascript
// Migration service running in the same k3s cluster
const sourceProvider = new JsonRpcProvider('http://base-node.rpcaas.svc.cluster.local:8545');
// No API key, no rate limit, no metering — internal traffic only
```

## Future Enhancements

1. **Web interface**: Upload contract addresses, click "Migrate", get a new L2aaS chain with your contracts
2. **Automatic storage layout detection**: Use source-verified contracts on Etherscan/Sourcify to auto-detect storage layouts
3. **Continuous sync**: Keep destination chain in sync with source (like a read replica) until cutover
4. **Multi-contract dependency resolver**: Automatically detect and handle cross-contract references
5. **Verification report**: Side-by-side comparison of source and destination state after migration
