/**
 * RPCaaS Proxy — Multi-chain RPC endpoint proxy with CDN-style caching.
 *
 * Routes: POST /v1/:chain/:apiKey
 * Authenticates the API key, checks rate limits, meters usage,
 * checks in-memory cache, forwards JSON-RPC to the appropriate chain full node.
 *
 * CDN Architecture: This proxy runs on EVERY k3s node as a DaemonSet.
 * Only node-uk1 runs full nodes. Cache hits return in 5-20ms,
 * cache misses forward to UK (100-200ms).
 */

import express, { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { resolveChain, getEndpoint, getChainConfig, listChains, CHAINS } from './chains';
import { apiKeyStore, TIERS } from './auth';
import { metering } from './metering';

// ---------------------------------------------------------------------------
// In-memory TTL cache
// ---------------------------------------------------------------------------

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

// Periodic cache cleanup (every 60s, remove expired entries)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expires) cache.delete(key);
  }
}, 60_000);

// TTL per RPC method (milliseconds)
const METHOD_TTL: Record<string, number> = {
  'eth_blockNumber': 2000,
  'eth_gasPrice': 5000,
  'eth_getCode': 86400000,         // 24h (immutable)
  'eth_getBalance': 10000,
  'eth_getStorageAt': 10000,
  'eth_call': 5000,
  'eth_getTransactionReceipt': 86400000, // 24h (immutable)
  'eth_getLogs': 30000,
  'eth_chainId': 86400000,         // 24h (immutable)
  'net_version': 86400000,         // 24h (immutable)
};

// Never cache these (write operations)
const NO_CACHE = new Set(['eth_sendRawTransaction', 'eth_sendTransaction']);

/**
 * Build a cache key from chain, method, and params.
 */
function buildCacheKey(chain: string, method: string, params: any[]): string {
  const paramsHash = createHash('sha256').update(JSON.stringify(params || [])).digest('hex').slice(0, 16);
  return `${chain}:${method}:${paramsHash}`;
}

/**
 * Determine TTL for a given method and params.
 * Historical queries (specific block number, not 'latest') are cached forever.
 */
function getTTL(method: string, params: any[]): number {
  if (NO_CACHE.has(method)) return 0;

  // Historical queries with specific block numbers are immutable
  if (params && params.length > 0) {
    const lastParam = params[params.length - 1];
    if (typeof lastParam === 'string' && lastParam.startsWith('0x') && lastParam !== 'latest' && lastParam !== 'pending' && lastParam !== 'earliest') {
      // Specific block number — immutable
      return 86400000;
    }
  }

  return METHOD_TTL[method] || 5000; // Default 5s TTL for unknown methods
}

const app = express();
const PORT = parseInt(process.env.PORT || '3100', 10);

// Parse JSON bodies up to 1MB (JSON-RPC requests are typically small)
app.use(express.json({ limit: '1mb' }));

// Request ID middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  res.setHeader('X-Request-Id', requestId);
  (req as any).requestId = requestId;
  next();
});

// CORS headers (allow all origins for RPC)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

/**
 * Health check endpoint. Verifies UK connectivity and reports cache stats.
 */
app.get('/health', async (_req: Request, res: Response) => {
  const chains = listChains().map(name => {
    const config = getChainConfig(name);
    return {
      name: config?.name,
      chainId: config?.chainId,
      endpoint: config?.endpoints[0] ? 'configured' : 'missing',
    };
  });

  // Verify UK full node connectivity
  let ukConnectivity = 'unknown';
  const upstreamUrl = process.env.UPSTREAM_URL;
  if (upstreamUrl) {
    try {
      const checkStart = Date.now();
      const resp = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'net_version', params: [], id: 1 }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        ukConnectivity = `ok (${Date.now() - checkStart}ms)`;
      } else {
        ukConnectivity = `error (HTTP ${resp.status})`;
      }
    } catch (err: any) {
      ukConnectivity = `unreachable (${err.message})`;
    }
  } else {
    ukConnectivity = 'no UPSTREAM_URL configured';
  }

  res.json({
    status: ukConnectivity.startsWith('ok') || !upstreamUrl ? 'ok' : 'degraded',
    version: '1.1.0',
    chains,
    cache: {
      entries: cache.size,
      maxEntries: '~unlimited (in-memory)',
    },
    ukConnectivity,
    apiKeys: apiKeyStore.size,
    timestamp: new Date().toISOString(),
  });
});

/**
 * List supported chains.
 */
app.get('/v1/chains', (_req: Request, res: Response) => {
  const chains = Object.entries(CHAINS).map(([key, config]) => ({
    id: key,
    name: config.name,
    chainId: config.chainId,
    aliases: config.aliases,
    wsSupported: config.wsSupported,
  }));
  res.json({ chains });
});

/**
 * Main RPC proxy endpoint.
 * POST /v1/:chain/:apiKey
 */
app.post('/v1/:chain/:apiKey', async (req: Request, res: Response) => {
  const { chain: chainParam, apiKey } = req.params;

  // 1. Resolve chain alias
  const chain = resolveChain(chainParam as string);
  if (!chain) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: `Unsupported chain: ${chainParam}. Supported: ${listChains().join(', ')}`,
      },
      id: req.body?.id || null,
    });
    return;
  }

  // 2. Validate API key
  const keyRecord = apiKeyStore.validate(apiKey as string);
  if (!keyRecord) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32002,
        message: 'Invalid or expired API key',
      },
      id: req.body?.id || null,
    });
    return;
  }

  // 3. Check rate limits and meter
  const meterResult = metering.check(apiKey as string, keyRecord.tier);

  // Set rate limit headers regardless of result
  res.setHeader('X-RateLimit-Limit', meterResult.dailyLimit === Infinity ? 'unlimited' : meterResult.dailyLimit.toString());
  res.setHeader('X-RateLimit-Remaining', meterResult.dailyRemaining === Infinity ? 'unlimited' : meterResult.dailyRemaining.toString());
  res.setHeader('X-RateLimit-Reset', meterResult.resetAt.toString());

  if (!meterResult.allowed) {
    const messages: Record<string, string> = {
      rate_limit: `Rate limit exceeded (${TIERS[keyRecord.tier].ratePerSec} req/sec). Slow down.`,
      daily_limit: `Daily request limit exceeded (${TIERS[keyRecord.tier].dailyLimit}). Resets at midnight UTC.`,
      monthly_limit: `Monthly request limit exceeded (${TIERS[keyRecord.tier].monthlyLimit}). Upgrade your tier.`,
    };
    res.status(429).json({
      jsonrpc: '2.0',
      error: {
        code: -32005,
        message: messages[meterResult.reason || 'unknown'] || 'Rate limit exceeded',
      },
      id: req.body?.id || null,
    });
    return;
  }

  // 4. Get chain endpoint
  const endpoint = getEndpoint(chain);
  if (!endpoint) {
    res.status(503).json({
      jsonrpc: '2.0',
      error: {
        code: -32003,
        message: `Chain ${chain} is not available. Node may be syncing.`,
      },
      id: req.body?.id || null,
    });
    return;
  }

  // 5. Check cache before forwarding to upstream
  const method = req.body?.method || '';
  const params = req.body?.params || [];
  const ttl = getTTL(method, params);
  const cacheKey = buildCacheKey(chain, method, params);

  // Check cache (skip for write operations)
  if (ttl > 0) {
    const cached = getCached(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Chain', chain);
      res.setHeader('X-Upstream-Latency', '0ms');
      res.status(200).json({ ...cached, id: req.body?.id || null });
      return;
    }
  }

  // 6. Forward JSON-RPC request to chain node (cache miss or write op)
  try {
    const startTime = Date.now();

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30_000), // 30s timeout
    });

    const data: any = await response.json();
    const latency = Date.now() - startTime;

    // Cache the response if cacheable and successful (no error in response)
    if (ttl > 0 && !data.error) {
      setCache(cacheKey, data, ttl);
    }

    // Add latency/cache headers for debugging
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Upstream-Latency', `${latency}ms`);
    res.setHeader('X-Chain', chain);

    res.status(response.status).json(data);
  } catch (err: any) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      res.status(504).json({
        jsonrpc: '2.0',
        error: {
          code: -32004,
          message: `Chain node timeout (30s). The node may be overloaded.`,
        },
        id: req.body?.id || null,
      });
      return;
    }

    console.error(`[${chain}] Upstream error:`, err.message);
    res.status(502).json({
      jsonrpc: '2.0',
      error: {
        code: -32003,
        message: 'Chain node unavailable',
      },
      id: req.body?.id || null,
    });
  }
});

/**
 * Catch-all for unsupported routes.
 */
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found. Use POST /v1/{chain}/{apiKey} for RPC calls.',
    docs: 'https://rpc.opsalis.com/docs',
  });
});

/**
 * Start server.
 */
app.listen(PORT, () => {
  console.log(`RPCaaS proxy listening on :${PORT}`);
  console.log(`Supported chains: ${listChains().join(', ')}`);

  // Seed demo keys in development
  if (process.env.NODE_ENV !== 'production') {
    console.log('Seeding demo API keys:');
    apiKeyStore.seedDemoKeys();
  }
});

export default app;
