/**
 * RPCaaS Proxy — Multi-chain RPC endpoint proxy.
 *
 * Routes: POST /v1/:chain/:apiKey
 * Authenticates the API key, checks rate limits, meters usage,
 * forwards JSON-RPC to the appropriate chain full node.
 */

import express, { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { resolveChain, getEndpoint, getChainConfig, listChains, CHAINS } from './chains';
import { apiKeyStore, TIERS } from './auth';
import { metering } from './metering';

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
 * Health check endpoint.
 */
app.get('/health', (_req: Request, res: Response) => {
  const chains = listChains().map(name => {
    const config = getChainConfig(name);
    return {
      name: config?.name,
      chainId: config?.chainId,
      endpoint: config?.endpoints[0] ? 'configured' : 'missing',
    };
  });
  res.json({
    status: 'ok',
    version: '1.0.0',
    chains,
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
  const chain = resolveChain(chainParam);
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
  const keyRecord = apiKeyStore.validate(apiKey);
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
  const meterResult = metering.check(apiKey, keyRecord.tier);

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

  // 5. Forward JSON-RPC request to chain node
  try {
    const startTime = Date.now();

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30_000), // 30s timeout
    });

    const data = await response.json();
    const latency = Date.now() - startTime;

    // Add latency header for debugging
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
