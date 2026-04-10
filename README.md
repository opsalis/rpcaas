# RPCaaS — Multi-chain RPC Endpoints

Multi-chain RPC endpoints for L2 developers. Read/write Base, Optimism, Arbitrum, Polygon, Ethereum. Pay with USDC.

## Quick Start

```bash
# Get your API key (coming soon — free tier: 100K requests/day)
curl https://rpc.opsalis.com/v1/base/YOUR_API_KEY \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

## Supported Chains

| Chain | Chain ID | Alias |
|-------|----------|-------|
| Base | 8453 | `base`, `base-mainnet`, `8453` |
| Optimism | 10 | `optimism`, `op`, `10` |
| Arbitrum One | 42161 | `arbitrum`, `arb`, `42161` |
| Polygon PoS | 137 | `polygon`, `matic`, `137` |
| Ethereum | 1 | `ethereum`, `eth`, `1` |

## Pricing

| Tier | Requests/month | Price |
|------|---------------|-------|
| Free | 3M (100K/day) | $0 |
| Growth | 30M | $10/month |
| Pro | 300M | $50/month |
| Enterprise | Unlimited | $200/month |

## Project Structure

```
proxy/          — RPC proxy service (Node.js/TypeScript)
nodes/          — Helm charts for blockchain full nodes
website/        — Cloudflare Pages landing page
provisioner/    — Auto-create API keys on payment
contracts/      — (future) Metering smart contracts
docs/           — Documentation
```

## Development

```bash
cd proxy
npm install
npm run dev
```

## License

Proprietary. All rights reserved.
