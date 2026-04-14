# ChainRPC — Scaling & Autoscale Architecture

**Version:** 1.0
**Date:** 2026-04-14
**Target:** 100,000 RPC calls/second sustained throughput

---

## 1. Current State

ChainRPC (RPCaaS) runs as a **DaemonSet** on all k3s nodes: one proxy pod per node, stateless, forwarding JSON-RPC requests to full nodes on `node-uk1` (London). Redis in-memory cache reduces upstream load.

**Current bottlenecks:**
- Single full-node host (node-uk1): all cache misses hit one machine
- DaemonSet model: pods scale with nodes, not with traffic
- No custom HPA metric: CPU alone is a poor signal for an I/O-bound proxy
- No Redis cluster: in-memory cache is per-pod, not shared

**Estimated current peak capacity:** ~500-2,000 RPS total (across all pods, limited by upstream node-uk1 connection pool and single-host I/O).

---

## 2. Target: 100K RPC Calls/Second

### Stress Test Acceptance Criteria

| Metric | Target |
|---|---|
| Sustained RPS | 100,000 req/sec |
| Test duration | 1 hour |
| Concurrent virtual users | 1,000 |
| p50 latency (cache hit) | < 10ms |
| p95 latency (cache hit) | < 50ms |
| p95 latency (cache miss) | < 150ms |
| Error rate | < 1% |
| Cache hit rate | > 70% |

At 100K RPS with 70% cache hit rate, only 30K RPS reach the upstream full nodes. This is achievable with 3-5 full node replicas (or geographic distribution of node-uk1 to additional regions).

---

## 3. How to Achieve 100K RPS

### 3.1 Switch from DaemonSet to Deployment + HPA

The current DaemonSet runs exactly one pod per k3s node. This couples capacity to node count, not traffic. Replace with a **Deployment** (replica count managed by HPA).

**Target:** 5 pods minimum, 50 pods maximum. Each pod handles ~2,000 RPS at 60% CPU.

Math: 50 pods × 2,000 RPS/pod = **100,000 RPS peak capacity**.

Each proxy pod is stateless (auth lookup in Redis, rate-limit counter in Redis). Scaling horizontally has no coordination cost.

### 3.2 Horizontal Pod Autoscaler (HPA)

HPA v2 with two signals:

**Signal 1 — CPU utilization:** Scale when average CPU across proxy pods exceeds 60%. CPU rises linearly with request rate for a proxy doing JSON parsing, Redis lookups, and HTTP forwarding.

**Signal 2 — Request rate (custom metric):** Expose `rpc_requests_per_second` from each pod via a `/metrics` Prometheus endpoint. Prometheus Adapter translates this to a k8s custom metric. HPA scales to keep `rpc_requests_per_second_per_pod < 2000`.

HPA configuration (descriptive — no YAML per mission rules):

```
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: rpc-proxy-hpa
  namespace: rpc-system
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: rpc-proxy
  minReplicas: 5
  maxReplicas: 50
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    - type: Pods
      pods:
        metric:
          name: rpc_requests_per_second
        target:
          type: AverageValue
          averageValue: "2000"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Pods
          value: 5
          periodSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
```

Scale-up is aggressive (5 new pods every 30s). Scale-down is conservative (2 pods removed per 60s, 5-minute stabilization window) to avoid flapping.

### 3.3 Node Autoscaler (k3s Cluster Autoscaler)

**Problem:** Karpenter does not support k3s natively (it requires AWS EKS or Kubernetes cloud-provider hooks). k3s uses its own agent model.

**Solution options (choose one):**

**Option A — cluster-autoscaler-on-VPS (recommended for now):**
Run `cluster-autoscaler` with a custom cloud provider script. When HPA cannot place new pods (all nodes at capacity), cluster-autoscaler calls a provisioner script that:
1. SSH into Hetzner/OVH API
2. Provisions a new CX21 node (2 vCPU, 4GB, ~€4/mo)
3. Joins it to k3s cluster via token
4. Labels it `role: rpc-proxy`
5. New pods get scheduled within 90 seconds

**Option B — Prometheus alert + manual runbook:**
Prometheus fires alert when `kube_pod_status_phase{phase="Pending"} > 0` for more than 3 minutes. Alert triggers n8n webhook which runs the provisioner script. Slower (3-5 min reaction time) but simpler to operate.

**Option C — Pre-warmed node pool:**
Maintain 3 "warm" standby nodes (stopped VMs, not billed for compute). On scale signal, boot them (30s) and join the cluster. Predictable cost, faster than provisioning fresh.

**Recommendation for Phase 1 of scaling:** Option B (Prometheus alert + n8n webhook). Implement Option A when sustained 100K RPS is needed continuously.

### 3.4 Shared Redis Cache (Replace Per-Pod In-Memory Cache)

Current in-memory cache is per-pod: pod A caches `eth_blockNumber`, pod B does not benefit. At 50 pods, this multiplies upstream load by 50×.

**Solution:** Deploy Redis cluster (3 nodes, HA with Sentinel) in k3s. All proxy pods share one cache. Cache hit rates improve dramatically because hot keys are shared.

**Redis cluster spec:**
- 3 pods: 1 primary + 2 replicas
- 512MB RAM per pod (hot RPC results are small JSON, easily fits)
- Persistence: AOF disabled (cache is ephemeral, reconstruction cost is one upstream call)
- Eviction policy: `allkeys-lru` (discard least-recently-used when full)

**Cache key format:** `{chain}:{method}:{keccak256(params)}` — deterministic, shared across all proxy pods.

### 3.5 Upstream RPC Connection Pool

Node-uk1 can handle ~5,000 upstream RPC requests/second per chain (limited by geth's HTTP server thread pool and disk I/O for state lookups). At 30K cache-miss RPS hitting 5 chains, that is 6,000 RPS per chain — at the edge of single-host capacity.

**Short-term solution:** Increase geth `--http.api` connection limit and `--cache` flags on node-uk1. Add a second HDD for parallel I/O on chains that are disk-bound (Ethereum mainnet, Polygon).

**Medium-term solution:** Add node-uk2 (same Kimsufi spec, €17/mo). Run Base and Optimism on uk2, keep Ethereum and Polygon on uk1. Proxy routes by chain to the appropriate upstream node. This doubles upstream capacity to ~10,000 RPS per chain.

**Long-term solution (Phase 3):** Add nodes in US-East and Asia-Pacific. Geo-route cache misses to nearest node. Reduces cross-continental latency from 150ms to <30ms.

**Connection pooling:** Proxy maintains persistent HTTP keep-alive connections to upstream nodes. Each proxy pod maintains a pool of 100 connections to each chain's upstream node. Connections are reused across requests. This eliminates TCP handshake overhead (saves ~10ms per cache-miss request).

### 3.6 Per-Customer Rate Limiting

Rate limiting enforced at the Order Service (or in-proxy) via Redis INCR:

```
Key: ratelimit:{api_key}:{window_start}
TTL: window_size (1s for per-second limits, 86400 for daily limits)
Value: INCR atomically, compare to tier limit
```

If over limit: return HTTP 429 with `Retry-After` header. Do NOT forward to upstream — this protects full nodes from abusive keys.

Rate limits by tier:

| Tier | Requests/second | Requests/day |
|---|---|---|
| Free | 10 | 100,000 |
| Growth | 50 | 1,000,000 |
| Pro | 200 | 10,000,000 |
| Enterprise | Custom (1,000+) | Unlimited |

---

## 4. Caching Strategy (Detailed)

Cache rules are defined once in `proxy/cache-rules.ts` and shared across all proxy pods.

| Method | TTL | Notes |
|---|---|---|
| `eth_blockNumber` | 2s | Changes every ~2s (Base) to 12s (Ethereum) |
| `eth_gasPrice` | 5s | Fluctuates with mempool |
| `eth_maxPriorityFeePerGas` | 5s | Same |
| `eth_getBlockByNumber("latest", *)` | 1s | Invalidate immediately on new block |
| `eth_getBlockByNumber(<N>, *)` | forever | Specific block = immutable |
| `eth_getBalance(addr, "latest")` | 10s | Changes on transfers |
| `eth_getBalance(addr, <N>)` | forever | Historical = immutable |
| `eth_getCode(addr, *)` | forever | Contract bytecode = immutable once deployed |
| `eth_getStorageAt(addr, slot, "latest")` | 5s | State changes on contract writes |
| `eth_getStorageAt(addr, slot, <N>)` | forever | Historical = immutable |
| `eth_call(*, "latest")` | 5s | View function results (shared across all users with same params) |
| `eth_call(*, <N>)` | forever | Historical = immutable |
| `eth_getTransactionByHash` | 30 days | Confirmed tx = immutable |
| `eth_getTransactionReceipt` | 30 days | Confirmed receipt = immutable |
| `eth_getLogs` with specific block range | forever | Historical logs = immutable |
| `eth_getLogs` with "latest" | 10s | Recent logs change |
| `eth_chainId` | forever | Immutable |
| `net_version` | forever | Immutable |
| `eth_sendRawTransaction` | **NEVER** | Write operation — always forward, never cache |
| `eth_estimateGas` | 5s | Estimate depends on current state |
| `eth_getTransactionCount` (nonce) | 2s | Changes on new tx from that address |

**Cache hit rate target:** 70%+ in steady state. The most common DeFi operations (read price, check balance, read contract state) are all cacheable. Write operations (`eth_sendRawTransaction`) are <5% of typical traffic.

---

## 5. Multi-Chain Expansion

Current chains: Base, Optimism, Arbitrum, Polygon, Ethereum (5 EVM chains).

### Target Chain List (Match ChainStack's 40+ chains)

**EVM chains (same JSON-RPC interface, same proxy logic):**
Ethereum, Base, Optimism, Arbitrum One, Arbitrum Nova, Polygon PoS, Polygon zkEVM, BNB Smart Chain, Avalanche C-Chain, Fantom, Celo, Linea, Scroll, zkSync Era, Mantle, Blast, Mode, Zora, Gnosis, Moonbeam, Cronos, Klaytn, Metis, Palm, Rootstock

**Non-EVM chains (require different proxy logic — separate handler per chain):**

| Chain | Protocol | Proxy complexity |
|---|---|---|
| Solana | Solana JSON-RPC (different method names) | Medium — similar HTTP JSON-RPC but different methods |
| Bitcoin | Bitcoin Core RPC | Low — simple JSON-RPC, no state |
| Tron | TronGrid HTTP API (not JSON-RPC) | High — completely different API format |
| Starknet | Starknet RPC (JSON-RPC-like, different types) | Medium |
| Cosmos Hub | Cosmos REST + Tendermint RPC | High — REST, not JSON-RPC |
| Polkadot | Substrate WebSocket RPC | High — WS only, different format |
| NEAR | NEAR RPC (JSON-RPC-like) | Medium |
| Aptos | Aptos REST API | Medium — REST |
| Sui | Sui JSON-RPC | Medium |
| Hedera | Hedera Mirror REST API | Medium — REST |
| Cardano | Cardano Submit API + Ogmios | High — multiple components |
| Dogecoin | Bitcoin-compatible RPC | Low |
| Litecoin | Bitcoin-compatible RPC | Low |
| Filecoin | Lotus JSON-RPC | Medium |

**Implementation order:** Add EVM chains first (zero new proxy code, just add upstream node URL to `chains.ts`). Non-EVM chains require chain-specific proxy handlers — implement in priority order based on customer demand.

---

## 6. Stress Test Plan

### Tool

**k6** (open-source, already in test-bench pattern). Runs from CX43 self-hosted CI to avoid GitHub Actions credit cost.

### Test Scenarios

**Scenario 1 — Steady State (baseline)**
- 100 VUs, each making 100 RPS
- Duration: 5 minutes
- Method mix: 70% cacheable (`eth_blockNumber`, `eth_call`), 30% non-cacheable (`eth_getBalance`)
- Expected: p95 < 50ms, error rate < 0.1%

**Scenario 2 — Ramp to 100K RPS**
- Ramp from 100 to 1,000 VUs over 5 minutes
- Each VU making 100 RPS
- Duration: 1 hour sustained after ramp
- Expected: HPA scales from 5 to 40+ pods, p95 < 100ms, error rate < 1%

**Scenario 3 — Write-heavy (no-cache pressure)**
- 200 VUs each sending `eth_sendRawTransaction` (always forwarded)
- Duration: 10 minutes
- Expected: upstream nodes handle ~20,000 write RPS, no cache benefit, latency higher (p95 < 300ms)

**Scenario 4 — Rate limit enforcement**
- 50 VUs each hammering same Free-tier key at 1,000 RPS
- Expected: 429 responses within milliseconds (Redis counter check), zero upstream forwarding, p95 of 429 response < 5ms

### Metrics to Capture

| Metric | Collection method |
|---|---|
| Request rate (RPS) | k6 built-in |
| p50/p95/p99 latency | k6 built-in |
| Error rate | k6 built-in |
| Cache hit rate | Prometheus counter: `rpc_cache_hits_total / rpc_requests_total` |
| Pod count over time | `kubectl get hpa -w` |
| Redis memory usage | Redis INFO memory |
| Upstream node CPU/IO | Grafana dashboard on node-uk1 |
| Queue depth (if batch) | BullMQ metrics |

### Pass/Fail Criteria

Test passes when ALL of the following are true for the full 1-hour sustained window:
1. RPS sustained ≥ 100,000
2. p95 latency ≤ 100ms
3. Error rate ≤ 1%
4. Cache hit rate ≥ 70%
5. No pod OOMKill events
6. No upstream node saturation (CPU < 80% on node-uk1)

### Bottleneck Identification Tree

If test fails, diagnose in this order:

1. **Error rate > 1%?** → Check error types. If 429 on valid keys: rate limit bug. If 502: upstream node down or connection pool exhausted. If 504: upstream timeout.
2. **High latency on cache hits?** → Redis latency (check `redis-cli LATENCY HISTORY`). If Redis is slow: increase Redis pod resources or switch to Redis Cluster.
3. **High latency on cache misses?** → Upstream node overloaded. Add node-uk2 or increase geth cache flags.
4. **Pods not scaling?** → HPA metrics not available. Check Prometheus adapter is installed and `kubectl get --raw "/apis/custom.metrics.k8s.io/v1beta1"` returns `rpc_requests_per_second`.
5. **Pods scaling but still saturated?** → Per-pod capacity lower than 2,000 RPS. Increase pod CPU request/limit or optimize proxy hot path (avoid synchronous DB calls on every request).

---

## 7. Cost and Margin Analysis

### Infrastructure Cost at 100K RPS

| Component | Spec | Monthly cost |
|---|---|---|
| 15 avg proxy pods (HPA avg) | 0.5 vCPU, 256MB each on existing nodes | ~$30 marginal |
| Redis cluster (3 pods) | 512MB each | ~$5 marginal |
| node-uk1 (full nodes) | Kimsufi KS-LE-B, existing | €17 (~$18) |
| node-uk2 (when added) | Same Kimsufi spec | €17 (~$18) |
| Cloudflare Tunnel | Existing | $0 |
| **Total at 100K RPS capacity** | | **~$71/mo** |

### Revenue

| Tier | Price | Customers for break-even |
|---|---|---|
| Free | $0 | N/A |
| Growth | $29/mo | 3 customers covers infra |
| Pro | $99/mo | 1 customer covers infra |
| 100 Pro customers | $9,900/mo | **98.5% gross margin** |

**Target margin:** 70% minimum. Actual achievable margin at scale: 95%+, because the proxy is compute-light (I/O bound, not CPU bound) and the full-node infra is shared across all chains.

---

## 8. Implementation Sequence (No Code — Future Session Contract)

### Step 1 — Prometheus metrics endpoint in proxy
Add `/metrics` endpoint to proxy pod. Expose: `rpc_requests_total`, `rpc_cache_hits_total`, `rpc_upstream_duration_seconds`, `rpc_active_connections`.

### Step 2 — Deploy Prometheus + Adapter in k3s
Install `kube-prometheus-stack` via Helm. Configure Prometheus Adapter to expose `rpc_requests_per_second` as a custom k8s metric.

### Step 3 — Convert DaemonSet to Deployment
Change proxy from DaemonSet to Deployment with `replicas: 5`. Verify pods distribute across nodes. Add `topologySpreadConstraints` to avoid all pods on one node.

### Step 4 — Deploy HPA
Apply HPA manifest targeting CPU (60%) + custom metric (2,000 RPS/pod). Verify `kubectl get hpa` shows correct target and current values.

### Step 5 — Deploy Shared Redis Cluster
Replace per-pod in-memory cache with Redis Cluster (3 pods). Update proxy `REDIS_URL` env var. Verify cache hit rate improves.

### Step 6 — Connection Pooling
Update proxy HTTP client to use keep-alive connection pool (Node.js `http.Agent` with `keepAlive: true`, `maxSockets: 100`). Benchmark cache-miss latency before/after.

### Step 7 — Stress Test
Run k6 Scenario 1, then 2. Capture all metrics. Tune HPA stabilization windows and per-pod RPS targets based on actual results. Re-test until pass criteria met.

### Step 8 — Node Autoscaler (if needed)
If Step 7 fails due to insufficient nodes: implement Prometheus alert → n8n webhook → Hetzner API provisioner. Add new nodes to k3s cluster automatically.
