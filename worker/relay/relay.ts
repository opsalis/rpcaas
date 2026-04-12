/**
 * ChainRPC Signing Relay
 *
 * Runs on CX43 (162.55.167.150). Cloudflare Workers can't do secp256k1,
 * so write transactions are routed through here.
 *
 * POST /relay/tx
 *   Body: { to: string, data: string, chainId: number }
 *   Header: X-Operator-Secret: <secret>
 *   Returns: { txHash: string }
 *
 * Start: node relay.js (after building with esbuild or ts-node)
 * Port: 3099 (behind nginx proxy for api.chainrpc.net/relay)
 */

import * as http from 'http';
import { createHash, randomBytes } from 'crypto';

const PRIVATE_KEY    = process.env.OPERATOR_KEY     || '';
const OPERATOR_SECRET = process.env.OPERATOR_SECRET || '';
const RPC_URL        = process.env.RPC_URL          || 'https://base-sepolia.chainrpc.net';
const PORT           = parseInt(process.env.PORT    || '3099', 10);
const CHAIN_ID       = parseInt(process.env.CHAIN_ID || '84532', 10);

if (!PRIVATE_KEY) {
  console.error('ERROR: OPERATOR_KEY not set');
  process.exit(1);
}
if (!OPERATOR_SECRET) {
  console.error('ERROR: OPERATOR_SECRET not set');
  process.exit(1);
}

// ── Minimal secp256k1 signing for Ethereum transactions ──────────────
// We use ethers.js (available on Node.js CX43)

async function main() {
  // Dynamic import of ethers (already installed on CX43 via wrapper)
  const { ethers } = await import('ethers');

  const wallet = new ethers.Wallet(PRIVATE_KEY, new ethers.JsonRpcProvider(RPC_URL));
  const addr = await wallet.getAddress();
  console.log(`Relay started. Operator: ${addr}, Port: ${PORT}, ChainID: ${CHAIN_ID}`);

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, operator: addr }));
      return;
    }

    if (req.method !== 'POST' || !req.url?.startsWith('/relay/tx')) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Auth check
    const secret = req.headers['x-operator-secret'];
    if (secret !== OPERATOR_SECRET) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Parse body
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const { to, data, chainId } = JSON.parse(body) as {
          to: string;
          data: string;
          chainId?: number;
        };

        if (!to || !data) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'to and data required' }));
          return;
        }

        // Send transaction
        const tx = await wallet.sendTransaction({
          to,
          data,
          chainId: chainId || CHAIN_ID,
        });

        console.log(`TX sent: ${tx.hash} to=${to} data=${data.slice(0, 10)}...`);

        res.writeHead(200);
        res.end(JSON.stringify({ txHash: tx.hash }));
      } catch (e) {
        console.error('Relay error:', (e as Error).message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Relay listening on 127.0.0.1:${PORT}`);
  });
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
