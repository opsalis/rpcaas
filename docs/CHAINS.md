# Supported Chains

## Base (Chain ID 8453)

| Property | Value |
|----------|-------|
| Chain ID | 8453 |
| Network | Base Mainnet |
| Type | OP Stack L2 (Optimistic Rollup) |
| Docker Images | `us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:latest` + `us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:latest` |
| Disk (Full Node) | ~150 GB |
| Disk (Archive) | ~2 TB+ |
| Sync Time | 2-3 days (snap sync) |
| RPC Port | 8545 |
| WS Port | 8546 |
| L1 Dependency | Requires Ethereum L1 RPC for op-node |

### Sync Command
```bash
# op-geth (execution)
op-geth \
  --op-network=base-mainnet \
  --http --http.addr=0.0.0.0 --http.port=8545 \
  --http.api=eth,net,web3,debug,txpool \
  --ws --ws.addr=0.0.0.0 --ws.port=8546 \
  --syncmode=snap --gcmode=full \
  --datadir=/data/geth \
  --authrpc.addr=0.0.0.0 --authrpc.port=8551 \
  --authrpc.jwtsecret=/data/jwt.hex \
  --rollup.sequencerhttp=https://mainnet-sequencer.base.org

# op-node (consensus)
op-node \
  --network=base-mainnet \
  --l1=http://ethereum-node:8545 \
  --l2=http://localhost:8551 \
  --l2.jwt-secret=/data/jwt.hex
```

### Special Considerations
- Base uses the OP Stack, same images as Optimism but with different network config
- op-geth needs `--rollup.sequencerhttp` pointing to Base's sequencer for fast block propagation
- op-node needs L1 Ethereum RPC to verify deposits and derive L2 blocks
- Snap sync downloads state trie from peers, much faster than full sync
- `--gcmode=full` keeps recent state only (not archive). Reduces disk from 2TB+ to ~150GB.

---

## Optimism (Chain ID 10)

| Property | Value |
|----------|-------|
| Chain ID | 10 |
| Network | OP Mainnet |
| Type | OP Stack L2 (Optimistic Rollup) |
| Docker Images | `us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:latest` + `us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:latest` |
| Disk (Full Node) | ~100 GB |
| Disk (Archive) | ~1.5 TB+ |
| Sync Time | 2-3 days (snap sync) |
| RPC Port | 8545 |
| WS Port | 8546 |
| L1 Dependency | Requires Ethereum L1 RPC for op-node |

### Sync Command
```bash
# op-geth
op-geth \
  --op-network=op-mainnet \
  --http --http.addr=0.0.0.0 --http.port=8545 \
  --http.api=eth,net,web3,debug,txpool \
  --ws --ws.addr=0.0.0.0 --ws.port=8546 \
  --syncmode=snap --gcmode=full \
  --datadir=/data/geth \
  --authrpc.addr=0.0.0.0 --authrpc.port=8551 \
  --authrpc.jwtsecret=/data/jwt.hex \
  --rollup.sequencerhttp=https://mainnet-sequencer.optimism.io

# op-node
op-node \
  --network=op-mainnet \
  --l1=http://ethereum-node:8545 \
  --l2=http://localhost:8551 \
  --l2.jwt-secret=/data/jwt.hex
```

### Special Considerations
- Identical software stack to Base (both are OP Stack)
- Different `--op-network` flag and sequencer URL
- Optimism mainnet is older than Base, so historical data is larger, but full node prunes it
- The Bedrock migration (2023) changed data format; snap sync starts post-Bedrock

---

## Arbitrum One (Chain ID 42161)

| Property | Value |
|----------|-------|
| Chain ID | 42161 |
| Network | Arbitrum One |
| Type | Arbitrum Nitro (Optimistic Rollup) |
| Docker Image | `offchainlabs/nitro-node:latest` |
| Disk (Full Node) | ~200 GB |
| Disk (Archive) | ~3 TB+ |
| Sync Time | 3-5 days |
| RPC Port | 8547 |
| WS Port | 8548 |
| L1 Dependency | Requires Ethereum L1 RPC for validation |

### Sync Command
```bash
nitro-node \
  --parent-chain.connection.url=http://ethereum-node:8545 \
  --chain.id=42161 \
  --http.addr=0.0.0.0 --http.port=8547 \
  --http.vhosts=* --http.corsdomain=* \
  --http.api=net,web3,eth,debug \
  --ws.addr=0.0.0.0 --ws.port=8548 \
  --ws.origins=* --ws.api=net,web3,eth,debug \
  --persistent.chain=/data/arb \
  --execution.caching.archive=false \
  --node.feed.input.url=wss://arb1.arbitrum.io/feed
```

### Special Considerations
- Nitro is a single binary (execution + consensus combined), simpler than OP Stack
- Default RPC port is 8547 (not 8545) — configure clients accordingly
- Requires the sequencer feed URL for real-time block ingestion
- `--execution.caching.archive=false` runs as full node (not archive), keeping disk manageable
- L1 connection is needed for fraud proof validation, not just derivation
- Nitro supports snapshot downloads for faster initial sync (check Arbitrum docs for URLs)

---

## Polygon PoS (Chain ID 137)

| Property | Value |
|----------|-------|
| Chain ID | 137 |
| Network | Polygon Mainnet |
| Type | PoS Sidechain (Ethereum-anchored) |
| Docker Images | `0xpolygon/bor:latest` + `0xpolygon/heimdall:latest` |
| Disk (Full Node) | ~250 GB |
| Disk (Archive) | ~8 TB+ |
| Sync Time | 5-7 days |
| RPC Port | 8545 |
| WS Port | 8546 |
| L1 Dependency | Requires Ethereum L1 RPC for Heimdall checkpoints |

### Sync Command
```bash
# Bor (execution)
bor server \
  --chain=mainnet \
  --datadir=/data/bor \
  --syncmode=full --gcmode=full \
  --http --http.addr=0.0.0.0 --http.port=8545 \
  --http.api=eth,net,web3,txpool,bor \
  --ws --ws.addr=0.0.0.0 --ws.port=8546 \
  --ws.api=eth,net,web3,txpool,bor \
  --bor.heimdall=http://localhost:1317

# Heimdall (consensus/checkpoint)
heimdall start \
  --home=/data/heimdall \
  --chain=mainnet \
  --eth_rpc_url=http://ethereum-node:8545 \
  --rest-server
```

### Special Considerations
- Polygon PoS is NOT a rollup; it's a separate PoS chain that checkpoints to Ethereum
- Two processes required: Bor (EVM execution, based on Geth) and Heimdall (Tendermint consensus)
- Heimdall needs Ethereum L1 RPC to verify checkpoints — our Ethereum node serves this
- Bor talks to Heimdall via REST API on port 1317
- Polygon has very high block rate (2s blocks) which means more data per day than other chains
- Snapshot sync available via Polygon's snapshot service (highly recommended, saves days)
- Archive node is extremely large (8TB+) — full node only for now

---

## Ethereum L1 (Chain ID 1)

| Property | Value |
|----------|-------|
| Chain ID | 1 |
| Network | Ethereum Mainnet |
| Type | PoS L1 |
| Docker Images | `ethereum/client-go:latest` (Geth) + `sigp/lighthouse:latest` (consensus) |
| Disk (Full Node) | ~900 GB |
| Disk (Archive) | ~15 TB+ |
| Sync Time | 7-14 days |
| RPC Port | 8545 |
| WS Port | 8546 |
| L1 Dependency | None (this IS L1) |

### Sync Command
```bash
# Geth (execution)
geth \
  --mainnet \
  --http --http.addr=0.0.0.0 --http.port=8545 \
  --http.api=eth,net,web3,debug,txpool \
  --ws --ws.addr=0.0.0.0 --ws.port=8546 \
  --syncmode=snap --gcmode=full \
  --datadir=/data/geth \
  --authrpc.addr=0.0.0.0 --authrpc.port=8551 \
  --authrpc.jwtsecret=/data/jwt.hex \
  --cache=4096 --maxpeers=50

# Lighthouse (consensus/beacon)
lighthouse bn \
  --network=mainnet \
  --datadir=/data/lighthouse \
  --http --http-address=0.0.0.0 --http-port=5052 \
  --execution-endpoint=http://localhost:8551 \
  --execution-jwt=/data/jwt.hex \
  --checkpoint-sync-url=https://beaconstate.ethstaker.cc \
  --disable-deposit-contract-sync
```

### Special Considerations
- Post-Merge Ethereum requires BOTH execution client (Geth) and consensus client (Lighthouse)
- They communicate via the Engine API on port 8551, authenticated with a shared JWT secret
- Snap sync for Geth downloads the state trie from peers (faster than full sync)
- Lighthouse checkpoint sync downloads the beacon state from a trusted endpoint (saves days vs genesis sync)
- `--gcmode=full` prunes old state, keeping disk at ~900GB instead of 15TB+ for archive
- This is the most resource-intensive node — 8GB+ RAM recommended for Geth, 4GB+ for Lighthouse
- Ethereum is the foundation node: Base, Optimism, Arbitrum, and Polygon all depend on it
- **Deploy this node LAST** (it takes the longest) but it must be running before L2 nodes can fully sync
- During initial L2 sync, you can temporarily use an external Ethereum RPC (e.g., a free Alchemy key) as a bridge
- `--cache=4096` allocates 4GB of RAM for Geth's internal caches — important for HDD performance

---

## Sync Order Recommendation

Deploy in this order to minimize total time and dependencies:

1. **Ethereum L1** — Start first (longest sync), all L2s depend on it
2. **Optimism** — Smallest L2, syncs quickly once Ethereum is available
3. **Base** — Similar to Optimism (same software stack)
4. **Arbitrum** — Medium size, independent sync after Ethereum is ready
5. **Polygon** — Largest L2 dataset, start last

During Ethereum sync, L2 nodes can use a temporary external RPC endpoint. Once our Ethereum node is synced, point all L2 nodes to it and remove the external dependency.

## Disk Budget

```
/dev/sdb (2TB) allocation:
  Ethereum:  900 GB
  Polygon:   250 GB
  Arbitrum:  200 GB
  Base:      150 GB
  Optimism:  100 GB
  MinIO:     400 GB
  ─────────────────
  Total:   2,000 GB (tight fit, monitor closely)
```

If disk gets tight, MinIO can be reduced or moved. Chain data grows over time even with pruning, so monitor monthly.
