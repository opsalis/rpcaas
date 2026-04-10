# RPCaaS Architecture

## Product Description

Multi-chain RPC endpoints for L2 developers. Read/write Base, Optimism, Arbitrum, Polygon, Ethereum. Pay with USDC. No KYC, no sign-up forms, anonymous API keys.

RPCaaS is the Alchemy/Infura/QuickNode competitor built on existing Opsalis infrastructure. Instead of paying $49-299/month for managed RPC, developers pay $0-200/month and get the same quality endpoints backed by our own full nodes.

## How It Works

1. Customer visits `rpc.opsalis.com` and gets an API key (free tier, no payment needed)
2. Customer calls `https://rpc.opsalis.com/v1/{chain}/{apiKey}` with standard JSON-RPC
3. Proxy validates the API key, checks rate limits, meters the request
4. Proxy forwards the JSON-RPC request to the appropriate chain full node
5. Full node processes the request and returns the response
6. Proxy returns the response to the customer

```
Customer → Cloudflare → Proxy (k3s) → Full Node (node-uk1) → Response
                          ↓
                     Metering DB
```

## URL Format

```
POST https://rpc.opsalis.com/v1/{chain}/{apiKey}

Chains: base, optimism, arbitrum, polygon, ethereum
Aliases: op, arb, matic, eth, or chain IDs (8453, 10, 42161, 137, 1)
```

WebSocket (future):
```
wss://rpc.opsalis.com/ws/v1/{chain}/{apiKey}
```

## Infrastructure

### Proxy Layer
- Runs as a Deployment in the k3s cluster
- Stateless — scales horizontally
- Exposed via Cloudflare Tunnel (no public IP needed)
- Port 3100 internally

### Full Node Layer
- All full nodes run on **node-uk1** (Kimsufi KS-LE-B, London)
- CPU: Intel Xeon E3-1230v6 (4C/8T, 3.5GHz)
- RAM: 32GB DDR4
- Storage: 2x 2TB HDD
- Network: 500Mbps guaranteed
- Cost: EUR 17/month

### Disk Layout (node-uk1)

```
/dev/sda (2TB HDD):
  /           — OS (Ubuntu 22.04)
  /var/lib/   — L1 validator + wrapper + k3s system
  
/dev/sdb (2TB HDD):
  /mnt/chains/base/       — Base full node data (~150GB)
  /mnt/chains/optimism/   — Optimism full node data (~100GB)
  /mnt/chains/arbitrum/   — Arbitrum full node data (~200GB)
  /mnt/chains/polygon/    — Polygon full node data (~250GB)
  /mnt/chains/ethereum/   — Ethereum full node data (~900GB)
  /mnt/minio/             — MinIO object storage (~400GB)
  
  Total: ~2000GB / 2000GB available
```

### Tiered Storage (Future)
- **Phase 1 (now):** Full nodes only. Current state, recent blocks. HDD is sufficient for full nodes.
- **Phase 2:** Archive nodes on dedicated SSD or ZFS pool when demand justifies second server.
- **Phase 3:** Geographic distribution — add nodes in US-East, Asia-Pacific for latency.

## Supported Chains

| Chain | Chain ID | Node Software | Disk | Sync Time |
|-------|----------|--------------|------|-----------|
| Base | 8453 | op-geth + op-node | ~150GB | 2-3 days |
| Optimism | 10 | op-geth + op-node | ~100GB | 2-3 days |
| Arbitrum One | 42161 | nitro-node | ~200GB | 3-5 days |
| Polygon PoS | 137 | bor + heimdall | ~250GB | 5-7 days |
| Ethereum | 1 | geth (full mode) | ~900GB | 7-14 days |

## Authentication

### API Key Format
```
rpk_<32 random hex characters>
Example: rpk_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
```

### Validation Flow
1. Extract API key from URL path
2. Look up key in database (Redis, fallback to SQLite)
3. Check tier and rate limits
4. If valid and within limits, forward request
5. Increment request counter
6. If invalid or over limit, return 401/429

### Rate Limits

| Tier | Requests/Day | Requests/Second | Monthly Total |
|------|-------------|-----------------|---------------|
| Free | 100,000 | 10 | 3,000,000 |
| Growth | 1,000,000 | 50 | 30,000,000 |
| Pro | 10,000,000 | 200 | 300,000,000 |
| Enterprise | Unlimited | 1,000 | Unlimited |

## Metering

### Phase 1: In-Memory
- Simple Map<apiKey, { count, lastReset }> in the proxy process
- Resets daily at midnight UTC
- Lost on restart (acceptable for free tier launch)

### Phase 2: Redis
- Redis deployed in k3s cluster
- Atomic INCR + EXPIRE for counters
- Survives proxy restarts
- Enables horizontal scaling (multiple proxy pods share state)

### Phase 3: On-Chain
- Metering smart contract on our L2 (chain 845301)
- Cryptographic proof of usage
- Enables trustless billing disputes
- Contract in `contracts/` directory (future)

## Proxy Architecture

```
proxy/
├── index.ts        — Express app, route handler, request forwarding
├── chains.ts       — Chain config: endpoints, chain IDs, aliases
├── auth.ts         — API key validation and tier lookup
├── metering.ts     — Request counting, rate limiting, daily reset
├── Dockerfile      — Multi-stage build (node:20-alpine)
└── k8s/
    ├── deployment.yaml  — Proxy Deployment (2 replicas)
    └── service.yaml     — ClusterIP service on port 3100
```

### Request Flow (Detailed)

```typescript
// 1. Parse chain + API key from URL
// 2. auth.validate(apiKey) → { tier, active }
// 3. metering.check(apiKey, tier) → { allowed, remaining }
// 4. If allowed: forward to chains.getEndpoint(chain)
// 5. metering.increment(apiKey)
// 6. Return response with X-RateLimit-* headers
```

### Response Headers
```
X-RateLimit-Limit: 100000
X-RateLimit-Remaining: 99842
X-RateLimit-Reset: 1712707200
X-Request-Id: <uuid>
```

## Node Architecture

Each chain runs as a Helm chart in k3s:

```
nodes/{chain}/
├── Chart.yaml
├── values.yaml
└── templates/
    ├── deployment.yaml  — Single pod, chain's official Docker image
    ├── service.yaml     — ClusterIP exposing RPC port
    └── pvc.yaml         — PersistentVolumeClaim on /dev/sdb mount
```

All nodes use `nodeSelector: role: rpc` to pin to node-uk1.

### Node Health
- Each node exposes a health endpoint (eth_syncing or equivalent)
- Proxy checks node health before forwarding
- If a node is syncing or down, proxy returns 503 with Retry-After header

## Integration with Other Products

### Sertone (Wrapper)
- Current: Wrapper uses Alchemy for Base RPC calls (USDC settlement, RouterV4)
- After RPCaaS: Wrapper uses `http://base-node:8545` (internal k8s service)
- Zero external dependency for Base chain reads
- Saves Alchemy API costs entirely

### L2aaS
- L2aaS customers get free RPC access to read other chains
- Use case: L2aaS customer's dApp needs to read Ethereum mainnet state
- Implementation: L2aaS provisioner creates a free-tier RPCaaS key for each L2aaS customer
- Cross-product value: "Get your own L2 + free multi-chain reads"

### Chain Migration
- Reads all state from source chain via our full nodes
- Writes to destination chain (L2aaS customer's L2)
- Flow: eth_getCode + eth_getStorageAt on source → deploy transactions on destination
- Free when migrating TO L2aaS (customer acquisition tool)
- Paid when migrating to external chains (cost + 500% markup)

### All Products
- Share the same k3s cluster
- Share the same OVH/Kimsufi infrastructure
- Share the same Cloudflare Tunnel ingress
- Settlement via USDC on Base (same RouterV4 contract)

## Security

### API Key Security
- Keys are hashed (SHA-256) before storage
- Raw key shown once at creation, never again
- Keys can be rotated without downtime (grace period on old key)

### Network Security
- Full nodes are not exposed to the internet (ClusterIP only)
- Proxy is the only ingress point (via Cloudflare Tunnel)
- Cloudflare WAF filters malicious requests
- No SSH to node-uk1 from public internet

### Rate Limiting
- Per-key rate limiting (requests per second)
- Per-key daily quota
- Global rate limiting at Cloudflare level (DDoS protection)
- Slowloris / connection exhaustion protection via Express timeout

## Deployment

### Initial Setup
1. Prepare node-uk1: partition /dev/sdb, mount to /mnt/chains
2. Install k3s agent on node-uk1 (joins existing cluster)
3. Label node: `kubectl label node node-uk1 role=rpc`
4. Deploy chain nodes via Helm (one at a time, each takes days to sync)
5. Deploy proxy to k3s
6. Configure Cloudflare Tunnel for rpc.opsalis.com

### Sync Order (by disk size, smallest first)
1. Optimism (~100GB, 2-3 days)
2. Base (~150GB, 2-3 days)
3. Arbitrum (~200GB, 3-5 days)
4. Polygon (~250GB, 5-7 days)
5. Ethereum (~900GB, 7-14 days)

Total time to full sync: approximately 3-4 weeks sequential.

### Monitoring
- Grafana dashboards for:
  - Requests per second per chain
  - Error rates per chain
  - Node sync status
  - Disk usage per chain
  - API key usage (top consumers)
- Alerts: node out of sync, disk > 85%, error rate > 5%

## Future Enhancements

1. **WebSocket support** — Subscribe to new blocks, pending transactions
2. **Archive nodes** — Historical state queries (eth_getBalance at block N)
3. **Geographic distribution** — US-East and Asia-Pacific PoPs
4. **Batch RPC** — Multiple JSON-RPC calls in one HTTP request (already supported by standard)
5. **Enhanced analytics** — Per-method breakdown, latency percentiles
6. **SDK** — npm package wrapping ethers.js with our endpoint defaults
7. **Webhook subscriptions** — Push notifications for on-chain events
