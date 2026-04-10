# RPCaaS API Reference

## Base URL

```
https://rpc.opsalis.com
```

## Authentication

All RPC calls require an API key in the URL path. Keys are formatted as `rpk_<32 hex characters>`.

```
POST /v1/{chain}/{apiKey}
```

## Supported Chains

| Chain | URL Path | Aliases |
|-------|----------|---------|
| Base | `/v1/base/{key}` | `base`, `base-mainnet`, `8453` |
| Optimism | `/v1/optimism/{key}` | `optimism`, `op`, `op-mainnet`, `10` |
| Arbitrum | `/v1/arbitrum/{key}` | `arbitrum`, `arb`, `arbitrum-one`, `42161` |
| Polygon | `/v1/polygon/{key}` | `polygon`, `matic`, `polygon-pos`, `137` |
| Ethereum | `/v1/ethereum/{key}` | `ethereum`, `eth`, `mainnet`, `1` |

## Rate Limits

| Tier | Requests/Day | Requests/Second | Monthly Limit |
|------|-------------|-----------------|---------------|
| Free | 100,000 | 10 | 3,000,000 |
| Growth | 1,000,000 | 50 | 30,000,000 |
| Pro | 10,000,000 | 200 | 300,000,000 |
| Enterprise | Unlimited | 1,000 | Unlimited |

### Rate Limit Headers

Every response includes rate limit information:

```
X-RateLimit-Limit: 100000
X-RateLimit-Remaining: 99842
X-RateLimit-Reset: 1712707200
X-Request-Id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
X-Chain: base
X-Upstream-Latency: 45ms
```

### Rate Limit Errors

When rate limited, the API returns HTTP 429:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32005,
    "message": "Rate limit exceeded (10 req/sec). Slow down."
  },
  "id": 1
}
```

## JSON-RPC Methods

RPCaaS proxies standard Ethereum JSON-RPC methods. All methods supported by the underlying node are available.

### Common Methods

| Method | Description |
|--------|-------------|
| `eth_blockNumber` | Latest block number |
| `eth_getBlockByNumber` | Block by number |
| `eth_getBlockByHash` | Block by hash |
| `eth_getTransactionByHash` | Transaction by hash |
| `eth_getTransactionReceipt` | Transaction receipt |
| `eth_call` | Execute call (read-only) |
| `eth_estimateGas` | Estimate gas for transaction |
| `eth_sendRawTransaction` | Submit signed transaction |
| `eth_getBalance` | Account balance |
| `eth_getCode` | Contract bytecode |
| `eth_getStorageAt` | Storage slot value |
| `eth_getLogs` | Event logs |
| `eth_gasPrice` | Current gas price |
| `eth_getTransactionCount` | Account nonce |
| `net_version` | Network ID |
| `web3_clientVersion` | Client version |
| `eth_syncing` | Sync status |
| `eth_chainId` | Chain ID |

### Batch Requests

Send multiple JSON-RPC calls in a single HTTP request:

```json
[
  {"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1},
  {"jsonrpc":"2.0","method":"eth_gasPrice","params":[],"id":2}
]
```

Response:

```json
[
  {"jsonrpc":"2.0","result":"0x134a5b7","id":1},
  {"jsonrpc":"2.0","result":"0x3b9aca00","id":2}
]
```

Each call in a batch counts as one request toward your rate limit.

## Examples

### curl

```bash
# Get latest block number on Base
curl https://rpc.opsalis.com/v1/base/rpk_YOUR_API_KEY \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Get ETH balance on Ethereum
curl https://rpc.opsalis.com/v1/ethereum/rpk_YOUR_API_KEY \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","latest"],"id":1}'

# Send transaction on Arbitrum
curl https://rpc.opsalis.com/v1/arbitrum/rpk_YOUR_API_KEY \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_sendRawTransaction","params":["0x...signed_tx_hex..."],"id":1}'
```

### ethers.js (v6)

```javascript
import { JsonRpcProvider } from 'ethers';

// Connect to Base
const provider = new JsonRpcProvider(
  'https://rpc.opsalis.com/v1/base/rpk_YOUR_API_KEY'
);

// Get latest block
const blockNumber = await provider.getBlockNumber();
console.log('Block:', blockNumber);

// Get balance
const balance = await provider.getBalance('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
console.log('Balance:', balance.toString());

// Read contract
const abi = ['function balanceOf(address) view returns (uint256)'];
const contract = new Contract('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', abi, provider);
const usdcBalance = await contract.balanceOf('0x...');
```

### web3.js (v4)

```javascript
import { Web3 } from 'web3';

const web3 = new Web3('https://rpc.opsalis.com/v1/optimism/rpk_YOUR_API_KEY');

const blockNumber = await web3.eth.getBlockNumber();
console.log('Block:', blockNumber);
```

### viem

```typescript
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const client = createPublicClient({
  chain: base,
  transport: http('https://rpc.opsalis.com/v1/base/rpk_YOUR_API_KEY'),
});

const blockNumber = await client.getBlockNumber();
```

### Python (web3.py)

```python
from web3 import Web3

w3 = Web3(Web3.HTTPProvider('https://rpc.opsalis.com/v1/polygon/rpk_YOUR_API_KEY'))
print('Block:', w3.eth.block_number)
print('Balance:', w3.eth.get_balance('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'))
```

### Hardhat

```javascript
// hardhat.config.js
module.exports = {
  networks: {
    base: {
      url: 'https://rpc.opsalis.com/v1/base/rpk_YOUR_API_KEY',
      chainId: 8453,
    },
    optimism: {
      url: 'https://rpc.opsalis.com/v1/optimism/rpk_YOUR_API_KEY',
      chainId: 10,
    },
    arbitrum: {
      url: 'https://rpc.opsalis.com/v1/arbitrum/rpk_YOUR_API_KEY',
      chainId: 42161,
    },
  },
};
```

### Foundry

```bash
# Deploy to Base
forge create src/MyContract.sol:MyContract \
  --rpc-url https://rpc.opsalis.com/v1/base/rpk_YOUR_API_KEY \
  --private-key $PRIVATE_KEY

# Call on Polygon
cast call 0x... "balanceOf(address)(uint256)" 0x... \
  --rpc-url https://rpc.opsalis.com/v1/polygon/rpk_YOUR_API_KEY
```

## Error Codes

| HTTP Status | JSON-RPC Code | Meaning |
|-------------|--------------|---------|
| 400 | -32001 | Unsupported chain |
| 401 | -32002 | Invalid or expired API key |
| 429 | -32005 | Rate limit exceeded |
| 502 | -32003 | Chain node unavailable |
| 503 | -32003 | Chain node syncing |
| 504 | -32004 | Chain node timeout (30s) |

Standard JSON-RPC errors from the chain node are passed through unchanged (e.g., -32000 for execution errors, -32602 for invalid params).

## Utility Endpoints

### Health Check

```
GET /health
```

Returns proxy status and supported chains:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "chains": [
    { "name": "Base", "chainId": 8453, "endpoint": "configured" },
    { "name": "Optimism", "chainId": 10, "endpoint": "configured" }
  ],
  "timestamp": "2026-04-11T12:00:00.000Z"
}
```

### List Chains

```
GET /v1/chains
```

Returns all supported chains with aliases:

```json
{
  "chains": [
    { "id": "base", "name": "Base", "chainId": 8453, "aliases": ["base", "base-mainnet", "8453"] }
  ]
}
```

## Limitations

- **Full nodes only** — No archive state queries. `eth_getBalance` at historical block numbers may fail.
- **No WebSocket** — WebSocket subscriptions are not yet supported. Coming soon.
- **No trace/debug on all chains** — `debug_traceTransaction` availability depends on the chain node configuration.
- **30-second timeout** — Requests that take longer than 30 seconds are aborted.
- **1MB request size limit** — JSON-RPC requests larger than 1MB are rejected.
