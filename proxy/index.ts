/**
 * ChainRPC Proxy — Multi-chain RPC with hostname-based routing + CDN caching.
 *
 * Each blockchain gets its own FQDN:
 *   POST https://ethereum.chainrpc.net/          (free tier, rate-limited)
 *   POST https://ethereum.chainrpc.net/KEY       (authenticated, higher limits)
 *   POST https://base.chainrpc.net/
 *   POST https://l1.chainrpc.net/                (Sertone L1)
 *   POST https://demo.chainrpc.net/              (Sertone Demo L2)
 *
 * Chain is resolved from req.hostname (subdomain → chain config).
 * Standard JSON-RPC: POST to root URL, no special headers needed.
 * Compatible with ethers.js, web3.js, viem, MetaMask, every RPC client.
 *
 * CDN Architecture: DaemonSet on every k3s node. Cache hits return in <5ms.
 * Cache misses forward to upstream RPCs with round-robin failover.
 */

import express, { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { resolveFromHostname, resolveChain, getEndpoint, getChainConfig, listChains, listPublicChainInfo, CHAINS, getHealthStatus } from './chains';
import { apiKeyStore, TIERS } from './auth';
import { metering } from './metering';

// ── In-memory TTL cache ─────────────────────────────────────────────

const cache = new Map<string, { data: any; expires: number }>();

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key: string, data: any, ttlMs: number): void {
  if (ttlMs <= 0) return;
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expires) cache.delete(key);
  }
}, 60_000);

const METHOD_TTL: Record<string, number> = {
  'eth_blockNumber': 2000,
  'eth_gasPrice': 5000,
  'eth_getCode': 86400000,
  'eth_getBalance': 10000,
  'eth_getStorageAt': 10000,
  'eth_call': 5000,
  'eth_getTransactionReceipt': 86400000,
  'eth_getLogs': 30000,
  'eth_chainId': 86400000,
  'net_version': 86400000,
};

const NO_CACHE = new Set(['eth_sendRawTransaction', 'eth_sendTransaction']);

function buildCacheKey(chain: string, method: string, params: any[]): string {
  const paramsHash = createHash('sha256').update(JSON.stringify(params || [])).digest('hex').slice(0, 16);
  return `${chain}:${method}:${paramsHash}`;
}

function getTTL(method: string, params: any[]): number {
  if (NO_CACHE.has(method)) return 0;
  if (params && params.length > 0) {
    const lastParam = params[params.length - 1];
    if (typeof lastParam === 'string' && lastParam.startsWith('0x') && lastParam !== 'latest' && lastParam !== 'pending' && lastParam !== 'earliest') {
      return 86400000;
    }
  }
  return METHOD_TTL[method] || 5000;
}

// ── Express app ─────────────────────────────────────────────────────

const app = express();
const PORT = parseInt(process.env.PORT || '3100', 10);

app.use(express.json({ limit: '1mb' }));

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Request-Id', uuidv4());
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

// ── Metrics counters ────────────────────────────────────────────────

const metrics = {
  requestsTotal: new Map<string, number>(),
  cacheHits: new Map<string, number>(),
  cacheMisses: new Map<string, number>(),
  errorsTotal: new Map<string, number>(),
  latencySum: new Map<string, number>(),
  latencyCount: new Map<string, number>(),
  rateLimited: 0,
  upSince: Date.now(),
};

function incMetric(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

// ── Health check ────────────────────────────────────────────────────

app.get('/health', async (_req: Request, res: Response) => {
  const health = getHealthStatus();
  const deadCount = Object.values(health).flat().filter(e => !e.alive).length;
  res.json({
    status: deadCount === 0 ? 'ok' : 'degraded',
    version: '2.1.0',
    routing: 'hostname-based ({chain}.chainrpc.net)',
    chains: listPublicChainInfo(),
    cache: { entries: cache.size },
    apiKeys: apiKeyStore.size,
    upstreamHealth: { dead: deadCount, total: Object.values(health).flat().length },
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/endpoints', async (_req: Request, res: Response) => {
  res.json(getHealthStatus());
});

// ── Prometheus metrics ──────────────────────────────────────────────

app.get('/metrics', (_req: Request, res: Response) => {
  const lines: string[] = [];
  const uptimeSec = Math.floor((Date.now() - metrics.upSince) / 1000);

  lines.push('# HELP chainrpc_up Whether the service is up (1=up)');
  lines.push('# TYPE chainrpc_up gauge');
  lines.push(`chainrpc_up 1`);

  lines.push('# HELP chainrpc_uptime_seconds Seconds since process start');
  lines.push('# TYPE chainrpc_uptime_seconds gauge');
  lines.push(`chainrpc_uptime_seconds ${uptimeSec}`);

  lines.push('# HELP chainrpc_cache_entries Current number of cache entries');
  lines.push('# TYPE chainrpc_cache_entries gauge');
  lines.push(`chainrpc_cache_entries ${cache.size}`);

  lines.push('# HELP chainrpc_requests_total Total RPC requests by chain');
  lines.push('# TYPE chainrpc_requests_total counter');
  for (const [chain, count] of metrics.requestsTotal) {
    lines.push(`chainrpc_requests_total{chain="${chain}"} ${count}`);
  }

  lines.push('# HELP chainrpc_cache_hits_total Cache hits by chain');
  lines.push('# TYPE chainrpc_cache_hits_total counter');
  for (const [chain, count] of metrics.cacheHits) {
    lines.push(`chainrpc_cache_hits_total{chain="${chain}"} ${count}`);
  }

  lines.push('# HELP chainrpc_cache_misses_total Cache misses by chain');
  lines.push('# TYPE chainrpc_cache_misses_total counter');
  for (const [chain, count] of metrics.cacheMisses) {
    lines.push(`chainrpc_cache_misses_total{chain="${chain}"} ${count}`);
  }

  lines.push('# HELP chainrpc_errors_total Upstream errors by chain');
  lines.push('# TYPE chainrpc_errors_total counter');
  for (const [chain, count] of metrics.errorsTotal) {
    lines.push(`chainrpc_errors_total{chain="${chain}"} ${count}`);
  }

  lines.push('# HELP chainrpc_upstream_latency_seconds_sum Total upstream latency by chain');
  lines.push('# TYPE chainrpc_upstream_latency_seconds_sum counter');
  for (const [chain, sum] of metrics.latencySum) {
    lines.push(`chainrpc_upstream_latency_seconds_sum{chain="${chain}"} ${(sum / 1000).toFixed(3)}`);
  }

  lines.push('# HELP chainrpc_upstream_latency_seconds_count Number of upstream calls by chain');
  lines.push('# TYPE chainrpc_upstream_latency_seconds_count counter');
  for (const [chain, count] of metrics.latencyCount) {
    lines.push(`chainrpc_upstream_latency_seconds_count{chain="${chain}"} ${count}`);
  }

  lines.push('# HELP chainrpc_rate_limited_total Total rate-limited requests');
  lines.push('# TYPE chainrpc_rate_limited_total counter');
  lines.push(`chainrpc_rate_limited_total ${metrics.rateLimited}`);

  lines.push('# HELP chainrpc_upstream_alive Whether upstream endpoint is alive (1=up, 0=down)');
  lines.push('# TYPE chainrpc_upstream_alive gauge');
  const health = getHealthStatus();
  for (const [chain, endpoints] of Object.entries(health)) {
    for (const ep of endpoints) {
      const label = ep.endpoint.replace(/https?:\/\//, '').replace(/[/:]/g, '_');
      lines.push(`chainrpc_upstream_alive{chain="${chain}",endpoint="${label}"} ${ep.alive ? 1 : 0}`);
    }
  }

  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n') + '\n');
});

app.get('/v1/chains', (_req: Request, res: Response) => {
  res.json({ chains: listPublicChainInfo() });
});

// ── Main RPC handler (hostname-based) ───────────────────────────────

app.post(['/', '/:apiKey'], async (req: Request, res: Response) => {
  const hostname = (req.hostname || req.headers.host || '').split(':')[0];
  const chain = resolveFromHostname(hostname);

  if (!chain) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: `Unknown chain for hostname "${hostname}". Use {chain}.chainrpc.net. Supported: ${listChains().join(', ')}`,
      },
      id: req.body?.id || null,
    });
    return;
  }

  const rawApiKey = req.params.apiKey;
  const apiKey: string = (typeof rawApiKey === 'string' ? rawApiKey : '')
    || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '')
    || '';

  let tier = 'free';
  if (apiKey) {
    const keyRecord = apiKeyStore.validate(apiKey);
    if (!keyRecord) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32002, message: 'Invalid or expired API key' },
        id: req.body?.id || null,
      });
      return;
    }
    tier = keyRecord.tier;
  }

  const meterId: string = apiKey || req.ip || 'anonymous';
  const meterResult = metering.check(meterId, tier as any);

  res.setHeader('X-RateLimit-Limit', meterResult.dailyLimit === Infinity ? 'unlimited' : meterResult.dailyLimit.toString());
  res.setHeader('X-RateLimit-Remaining', meterResult.dailyRemaining === Infinity ? 'unlimited' : meterResult.dailyRemaining.toString());
  res.setHeader('X-RateLimit-Reset', meterResult.resetAt.toString());
  res.setHeader('X-Chain', chain);
  if (meterResult.overflow) res.setHeader('X-Overflow', 'true');

  if (!meterResult.allowed) {
    metrics.rateLimited++;
    res.status(429).json({
      jsonrpc: '2.0',
      error: {
        code: -32005,
        message: `Rate limit exceeded. ${apiKey ? 'Upgrade your tier.' : 'Get a free API key at chainrpc.net for higher limits.'}`,
      },
      id: req.body?.id || null,
    });
    return;
  }

  incMetric(metrics.requestsTotal, chain);

  const endpoint = getEndpoint(chain);
  if (!endpoint) {
    res.status(503).json({
      jsonrpc: '2.0',
      error: { code: -32003, message: `Chain ${chain} is not available` },
      id: req.body?.id || null,
    });
    return;
  }

  const method = req.body?.method || '';
  const params = req.body?.params || [];
  const ttl = getTTL(method, params);
  const cacheKey = buildCacheKey(chain, method, params);

  if (ttl > 0) {
    const cached = getCached(cacheKey);
    if (cached) {
      incMetric(metrics.cacheHits, chain);
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Upstream-Latency', '0ms');
      res.status(200).json({ ...cached, id: req.body?.id || null });
      return;
    }
  }

  // Try each endpoint with automatic failover
  const chainConfig = getChainConfig(chain);
  const allEndpoints = chainConfig ? chainConfig.endpoints : [endpoint];
  const endpointList = [endpoint, ...allEndpoints.filter(e => e !== endpoint)];
  let lastErr: any = null;

  for (const tryEndpoint of endpointList) {
    try {
      const startTime = Date.now();
      const response = await fetch(tryEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(15_000),
      });

      const data: any = await response.json();
      const latency = Date.now() - startTime;

      incMetric(metrics.cacheMisses, chain);
      incMetric(metrics.latencySum, chain, latency);
      incMetric(metrics.latencyCount, chain);

      if (ttl > 0 && !data.error) setCache(cacheKey, data, ttl);

      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Upstream-Latency', `${latency}ms`);
      res.status(response.status).json(data);
      return;
    } catch (err: any) {
      lastErr = err;
      // Try next endpoint
    }
  }

  // All endpoints failed
  incMetric(metrics.errorsTotal, chain);
  if (lastErr?.name === 'AbortError' || lastErr?.name === 'TimeoutError') {
    res.status(504).json({
      jsonrpc: '2.0',
      error: { code: -32004, message: 'Chain node timeout (15s)' },
      id: req.body?.id || null,
    });
    return;
  }
  console.error(`[${chain}] All upstreams failed:`, lastErr?.message);
  res.status(503).json({
    jsonrpc: '2.0',
    error: { code: -32003, message: 'Chain node unavailable' },
    id: req.body?.id || null,
  });
});

// ── Backward compat: path-based → 301 redirect to hostname ──────────

app.post('/v1/:chain', (req: Request, res: Response) => {
  const chain = resolveChain(req.params.chain as string);
  const config = getChainConfig(chain || '');
  const domain = process.env.CHAINRPC_DOMAIN || 'chainrpc.net';
  if (config) {
    res.redirect(301, `https://${config.subdomain}.${domain}/`);
  } else {
    res.status(400).json({ error: `Unknown chain: ${req.params.chain}` });
  }
});

app.post('/v1/:chain/:apiKey', (req: Request, res: Response) => {
  const chain = resolveChain(req.params.chain as string);
  const config = getChainConfig(chain || '');
  const domain = process.env.CHAINRPC_DOMAIN || 'chainrpc.net';
  if (config) {
    res.redirect(301, `https://${config.subdomain}.${domain}/${req.params.apiKey}`);
  } else {
    res.status(400).json({ error: `Unknown chain: ${req.params.chain}` });
  }
});

// ── Catch-all ───────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found. POST JSON-RPC to https://{chain}.chainrpc.net/',
    chains: 'https://chainrpc.net/v1/chains',
  });
});

// ── Start ───────────────────────────────────────────────────────────

// Register internal key (unlimited tier for all Opsalis services)
const INTERNAL_KEY = process.env.CHAINRPC_INTERNAL_KEY || 'rpk_b79bf7a33b6baf60398b50b40265eafc';
apiKeyStore.registerWithTier(INTERNAL_KEY, 'internal', 'opsalis-internal');
console.log(`[Internal] Registered internal key (${INTERNAL_KEY.substring(0, 8)}...)`);

app.listen(PORT, () => {
  const chains = listChains();
  console.log(`ChainRPC proxy v2.1.0 listening on :${PORT}`);
  console.log(`Supported chains (${chains.length}): ${chains.join(', ')}`);
  console.log(`Routing: hostname-based ({chain}.chainrpc.net)`);

  if (process.env.NODE_ENV !== 'production') {
    console.log('Seeding demo API keys:');
    apiKeyStore.seedDemoKeys();
  }
});

export default app;
