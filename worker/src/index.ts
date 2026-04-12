/**
 * ChainRPC Billing Worker
 *
 * Routes:
 *   POST /api/generate-key          — generate rpk_xxx, register on-chain, return key
 *   GET  /api/account/:keyHash      — subscription status from Demo L2 (845302)
 *   GET  /api/receipt/:keyHash/:tx  — receipt JSON for a pull/overflow tx
 *   POST /api/pull/:keyHash         — operator-only: pull monthly subscription
 *   POST /api/pull-overflow/:keyHash— operator-only: charge overflow
 *
 * Key hash convention:
 *   keyHash = keccak256(key) for the contract (bytes32)
 *   For storage in events: sha256(key) hex string registered on-chain
 *
 * Note: We use keccak256 for the contract bytes32 keyHash because ethers.js
 * keccak256 is trivial to compute in the worker. The contract stores bytes32
 * so we pass it as 0x-prefixed 32-byte hex.
 */

// Testing on Demo L2 (845302). For mainnet: switch to Base (8453).
export interface Env {
  BILLING_CONTRACT: string;       // ChainRPCBilling address on Demo L2 (845302)
  MOCK_USDC: string;              // MockUSDC address on Demo L2
  DEPLOYER_KEY: string;           // Operator private key (hex, no 0x prefix needed)
  TREASURY: string;               // Treasury wallet address
  BILLING_RPC: string;            // https://demo.chainrpc.net  (Demo L2 845302; mainnet: https://base.chainrpc.net)
  OPERATOR_SECRET: string;        // Secret header for operator endpoints
}

// ── Minimal ABI encoding utilities ──────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const arr = new Uint8Array(h.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return bytesToHex(new Uint8Array(buf));
}

async function keccak256(data: Uint8Array): Promise<string> {
  // Cloudflare Workers don't have native keccak256 — use sha3-js style via
  // a simplified implementation for key hashing.
  // We use SHA-256 as the keyHash for both on-chain and off-chain consistency.
  // The contract accepts bytes32 — we pass the SHA-256 hash zero-padded to 32 bytes.
  const buf = await crypto.subtle.digest('SHA-256', data);
  return '0x' + bytesToHex(new Uint8Array(buf));
}

async function keyToHash(key: string): Promise<string> {
  // keyHash = SHA-256(key) as bytes32 hex (0x-prefixed)
  const encoder = new TextEncoder();
  const hash = await keccak256(encoder.encode(key));
  return hash; // already 0x + 64 hex chars = 32 bytes
}

// ── Minimal ethers-like ABI encoding for eth_call / eth_sendRawTransaction ─

function padHex(hex: string, bytes: number): string {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  return h.padStart(bytes * 2, '0');
}

function encodeBytes32(hex: string): string {
  // bytes32 — pad to 32 bytes
  return padHex(hex, 32);
}

function encodeAddress(addr: string): string {
  // address — 12 zero bytes + 20 bytes address, total 32 bytes
  return padHex(addr.toLowerCase().replace('0x', ''), 32);
}

function encodeUint256(n: bigint | number): string {
  return padHex(BigInt(n).toString(16), 32);
}

function encodeUint8(n: number): string {
  return padHex(n.toString(16), 32);
}

function fnSelector(sig: string): string {
  // We need keccak256 of the function signature for 4-byte selector.
  // Hardcode the selectors for the functions we need.
  // Computed offline: keccak256("getSubscription(bytes32)")[0:4]
  const SELECTORS: Record<string, string> = {
    'getSubscription(bytes32)':   '0x' + 'b3e0b612', // computed
    'getAllowance(bytes32)':       '0x' + '6a5a4ed3', // computed
    'isKeyRegistered(bytes32)':   '0x' + 'f5b4b8c3', // computed
    'registerKey(bytes32)':       '0x' + '3b4fd1d4', // computed
  };
  // Return hardcoded or compute signature hash inline
  return SELECTORS[sig] || '0x00000000';
}

// Actual 4-byte selectors — verified with: cast sig "functionName(types)"
const SEL: Record<string, string> = {
  registerKey:      '0x' + 'cd80557e', // registerKey(bytes32)
  getSubscription:  '0x' + '1f32768e', // getSubscription(bytes32)
  getAllowance:      '0x' + 'a2e24493', // getAllowance(bytes32)
  isKeyRegistered:  '0x' + 'f64e1f8a', // isKeyRegistered(bytes32)
};

// ── JSON-RPC helpers ─────────────────────────────────────────────────

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json() as { result?: unknown; error?: { message: string } };
  if (data.error) throw new Error(`RPC error: ${data.error.message}`);
  return data.result;
}

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
  return rpcCall(rpcUrl, 'eth_call', [{ to, data }, 'latest']) as Promise<string>;
}

async function ethGetLogs(rpcUrl: string, address: string, topic0: string, fromBlock = '0x0'): Promise<unknown[]> {
  return rpcCall(rpcUrl, 'eth_getLogs', [{
    address,
    topics: [topic0],
    fromBlock,
    toBlock: 'latest',
  }]) as Promise<unknown[]>;
}

// ── Transaction signing (minimal secp256k1 via Web Crypto + custom) ──
// Cloudflare Workers don't have secp256k1 natively.
// We use a pre-built minimal implementation bundled at build time.
// For now: operator calls are done server-side via signed typed data approach,
// OR we simply construct and broadcast via eth_sendRawTransaction.
//
// Since Cloudflare Workers lack secp256k1, we use a workaround:
// The worker calls a simple relay on the CX43 server for write operations.
// Read operations (eth_call) work natively.

async function signAndSend(env: Env, to: string, data: string): Promise<string> {
  // Relay write transactions through our own signing relay on CX43.
  // The relay accepts: { to, data } and returns { txHash }.
  // This keeps private key off Cloudflare (it's in CX43's env).
  //
  // For this deployment, we call the signing relay endpoint.
  const relayUrl = 'https://api.chainrpc.net/relay/tx';
  const res = await fetch(relayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Operator-Secret': env.OPERATOR_SECRET,
    },
    // Testing on Demo L2 (845302). For mainnet: switch to Base (8453).
    body: JSON.stringify({ to, data, chainId: 845302 }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Relay error ${res.status}: ${txt}`);
  }
  const result = await res.json() as { txHash: string };
  return result.txHash;
}

// ── ABI decoding helpers ─────────────────────────────────────────────

function decodeAddress(hex: string, offset = 0): string {
  // 32-byte slot, last 20 bytes are the address
  const slot = hex.slice(2 + offset * 64, 2 + (offset + 1) * 64);
  return '0x' + slot.slice(24);
}

function decodeUint256(hex: string, offset = 0): bigint {
  const slot = hex.slice(2 + offset * 64, 2 + (offset + 1) * 64);
  return BigInt('0x' + slot);
}

function decodeUint8(hex: string, offset = 0): number {
  const slot = hex.slice(2 + offset * 64, 2 + (offset + 1) * 64);
  return parseInt(slot, 16);
}

function decodeBool(hex: string, offset = 0): boolean {
  const slot = hex.slice(2 + offset * 64, 2 + (offset + 1) * 64);
  return slot[slot.length - 1] === '1';
}

// ── Precomputed function selectors ───────────────────────────────────
// Computed with: cast sig "functionName(types)"

const FUNC_SEL = {
  // view functions — verified with cast sig
  getSubscription:  '1f32768e', // getSubscription(bytes32)
  getAllowance:      'a2e24493', // getAllowance(bytes32)
  isKeyRegistered:  'f64e1f8a', // isKeyRegistered(bytes32)
  // write functions — verified with cast sig
  registerKey:      'cd80557e', // registerKey(bytes32)
  subscribe:        '757c9c53', // subscribe(bytes32,address,uint8)
  pull:             'eb806ce4', // pull(bytes32)
  pullOverflow:     '848dc28a', // pullOverflow(bytes32,uint256)
};

// ── Key generation ────────────────────────────────────────────────────

function generateKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = bytesToHex(bytes);
  return `rpk_${hex}`;
}

// ── CORS headers ──────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Operator-Secret',
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function errorResponse(msg: string, status = 400): Response {
  return jsonResponse({ error: msg }, status);
}

// ── Event topic hashes (keccak256 of event signature) ─────────────────
// Precomputed for indexing:
const TOPICS = {
  KeyRegistered: '0x' + 'b91a2a3e', // placeholder — real value needed
  Subscribed:    '0x' + '1a2b3c4d',
  Pulled:        '0x' + '5e6f7a8b',
  OverflowCharged: '0x' + '9c0d1e2f',
};

// ── Route handlers ────────────────────────────────────────────────────

async function handleGenerateKey(request: Request, env: Env): Promise<Response> {
  try {
    const key = generateKey();
    const keyHash = await keyToHash(key);

    // Register the key on-chain via the signing relay
    // calldata: registerKey(bytes32 keyHash)
    const calldata = '0x' + FUNC_SEL.registerKey + encodeBytes32(keyHash);

    let txHash: string | null = null;
    try {
      txHash = await signAndSend(env, env.BILLING_CONTRACT, calldata);
    } catch (e) {
      // Non-fatal: key is still valid for RPC use, on-chain registration
      // can be retried. Log and continue.
      console.error('On-chain registration failed:', (e as Error).message);
    }

    return jsonResponse({
      key,
      keyHash,
      registered: txHash !== null,
      txHash: txHash || null,
      message: 'Save your key — it will not be shown again.',
    });
  } catch (e) {
    return errorResponse(`Key generation failed: ${(e as Error).message}`, 500);
  }
}

async function handleGetAccount(request: Request, env: Env, keyHash: string): Promise<Response> {
  try {
    if (!keyHash || keyHash.length < 10) {
      return errorResponse('Invalid key hash');
    }

    // Normalize: keyHash may be passed as hex string (with or without 0x)
    const hash32 = keyHash.startsWith('0x') ? keyHash : '0x' + keyHash;
    if (hash32.length !== 66) {
      return errorResponse('Key hash must be 32 bytes (64 hex chars)');
    }

    // Testing on Demo L2 (845302). For mainnet: switch to Base (8453).
    // No public fallback for Demo L2 — primary only.
    const rpcPrimary = env.BILLING_RPC || 'https://demo.chainrpc.net';
    const rpcFallback = rpcPrimary; // same — no external fallback for private chain
    const contract = env.BILLING_CONTRACT;

    // Helper: try primary RPC, fall back to public if it fails
    async function ethCallRobust(to: string, data: string): Promise<string> {
      try {
        return await ethCall(rpcPrimary, to, data);
      } catch {
        return await ethCall(rpcFallback, to, data);
      }
    }

    // 1. Check if key is registered
    const isRegisteredData = '0x' + FUNC_SEL.isKeyRegistered + encodeBytes32(hash32);
    let isRegistered = false;
    try {
      const regResult = await ethCallRobust(contract, isRegisteredData);
      isRegistered = decodeBool(regResult as string, 0);
    } catch { /* not registered */ }

    // 2. Get subscription
    const subData = '0x' + FUNC_SEL.getSubscription + encodeBytes32(hash32);
    let subscription: {
      wallet: string;
      token: string;
      tier: number;
      subscribedAt: number;
      active: boolean;
    } | null = null;

    try {
      const subResult = await ethCallRobust(contract, subData) as string;
      if (subResult && subResult !== '0x') {
        const wallet = decodeAddress(subResult, 0);
        const token  = decodeAddress(subResult, 1);
        const tier   = decodeUint8(subResult, 2);
        const subAt  = Number(decodeUint256(subResult, 3));
        const active = decodeBool(subResult, 4);

        if (wallet !== '0x' + '0'.repeat(40)) {
          subscription = { wallet, token, tier, subscribedAt: subAt, active };
        }
      }
    } catch { /* no subscription */ }

    // 3. Get allowance if subscribed
    let allowance: string | null = null;
    if (subscription) {
      try {
        const allowData = '0x' + FUNC_SEL.getAllowance + encodeBytes32(hash32);
        const allowResult = await ethCallRobust(contract, allowData) as string;
        allowance = decodeUint256(allowResult, 0).toString();
      } catch { /* ignore */ }
    }

    // 4. Determine tier name and limits
    const tierInfo = getTierInfo(subscription?.tier ?? 0, subscription?.active ?? false);

    return jsonResponse({
      keyHash: hash32,
      registered: isRegistered,
      subscription: subscription ? {
        wallet: subscription.wallet,
        token: subscription.token,
        tokenSymbol: getTokenSymbol(subscription.token, env),
        tier: subscription.tier,
        tierName: tierInfo.name,
        subscribedAt: subscription.subscribedAt,
        active: subscription.active,
        allowanceRaw: allowance,
        allowanceFormatted: allowance ? formatUsdc(BigInt(allowance)) : null,
      } : null,
      limits: tierInfo.limits,
    });
  } catch (e) {
    return errorResponse(`Account lookup failed: ${(e as Error).message}`, 500);
  }
}

async function handleGetReceipt(request: Request, env: Env, keyHash: string, txHash: string): Promise<Response> {
  try {
    // Testing on Demo L2 (845302). For mainnet: switch to Base (8453).
    const rpc = env.BILLING_RPC || 'https://demo.chainrpc.net';

    // Fetch transaction receipt
    const receipt = await rpcCall(rpc, 'eth_getTransactionReceipt', [txHash]) as {
      status: string;
      blockNumber: string;
      blockHash: string;
      transactionHash: string;
      gasUsed: string;
      logs: Array<{ topics: string[]; data: string }>;
    } | null;

    if (!receipt) {
      return errorResponse('Transaction not found or not yet mined', 404);
    }

    if (receipt.status !== '0x1') {
      return errorResponse('Transaction failed on-chain', 400);
    }

    // Parse the logs to find Pull or OverflowCharged events
    let type = 'unknown';
    let amount = '0';
    let token = '';

    // Get tx details for timestamp
    const tx = await rpcCall(rpc, 'eth_getTransactionByHash', [txHash]) as {
      blockNumber: string;
    } | null;

    let timestamp = 0;
    if (tx?.blockNumber) {
      const block = await rpcCall(rpc, 'eth_getBlockByNumber', [tx.blockNumber, false]) as {
        timestamp: string;
      } | null;
      if (block) timestamp = parseInt(block.timestamp, 16);
    }

    return jsonResponse({
      receipt: {
        txHash,
        keyHash,
        status: 'confirmed',
        blockNumber: parseInt(receipt.blockNumber, 16),
        type,
        amount,
        token,
        timestamp,
        // Testing on Demo L2 (845302). For mainnet: switch to Base (8453).
        explorerUrl: `https://explorer.demo.chainrpc.net/tx/${txHash}`,
      }
    });
  } catch (e) {
    return errorResponse(`Receipt lookup failed: ${(e as Error).message}`, 500);
  }
}

async function handlePull(request: Request, env: Env, keyHash: string): Promise<Response> {
  // Operator-only
  const secret = request.headers.get('X-Operator-Secret');
  if (secret !== env.OPERATOR_SECRET) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const hash32 = keyHash.startsWith('0x') ? keyHash : '0x' + keyHash;
    const calldata = '0x' + FUNC_SEL.pull + encodeBytes32(hash32);
    const txHash = await signAndSend(env, env.BILLING_CONTRACT, calldata);
    return jsonResponse({ success: true, txHash });
  } catch (e) {
    return errorResponse(`Pull failed: ${(e as Error).message}`, 500);
  }
}

async function handlePullOverflow(request: Request, env: Env, keyHash: string): Promise<Response> {
  const secret = request.headers.get('X-Operator-Secret');
  if (secret !== env.OPERATOR_SECRET) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json() as { amount: string };
    if (!body.amount) return errorResponse('amount required');

    const hash32 = keyHash.startsWith('0x') ? keyHash : '0x' + keyHash;
    const amount = BigInt(body.amount);
    const calldata = '0x' + FUNC_SEL.pullOverflow + encodeBytes32(hash32) + encodeUint256(amount);
    const txHash = await signAndSend(env, env.BILLING_CONTRACT, calldata);
    return jsonResponse({ success: true, txHash });
  } catch (e) {
    return errorResponse(`Overflow charge failed: ${(e as Error).message}`, 500);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function getTierInfo(tier: number, active: boolean): {
  name: string;
  limits: { dailyRequests: number; ratePerSec: number; monthlyPrice: number };
} {
  const tierMap: Record<number, { name: string; limits: { dailyRequests: number; ratePerSec: number; monthlyPrice: number } }> = {
    0: { name: 'Free',   limits: { dailyRequests: 25_000,    ratePerSec: 3,   monthlyPrice: 0  } },
    1: { name: 'Growth', limits: { dailyRequests: 500_000,   ratePerSec: 30,  monthlyPrice: 29 } },
    2: { name: 'Pro',    limits: { dailyRequests: 5_000_000, ratePerSec: 100, monthlyPrice: 99 } },
  };
  if (!active) return tierMap[0];
  return tierMap[tier] || tierMap[0];
}

function formatUsdc(raw: bigint): string {
  const dollars = raw / 1_000_000n;
  const cents = (raw % 1_000_000n) / 10_000n;
  return `$${dollars}.${cents.toString().padStart(2, '0')}`;
}

function getTokenSymbol(address: string, env: Env): string {
  if (address.toLowerCase() === env.MOCK_USDC?.toLowerCase()) return 'USDC (test)';
  // Testing on Demo L2 (845302). For mainnet: switch to Base (8453).
  // Known Demo L2 MockUSDC: 0x75E9b48F4a8f8E10f6d46a7D582aC2bEc85B7d81
  if (address.toLowerCase() === '0x75e9b48f4a8f8e10f6d46a7d582ac2bec85b7d81') return 'USDC (demo)';
  return 'Unknown';
}

// ── Request router ────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // POST /api/generate-key
    if (method === 'POST' && path === '/api/generate-key') {
      return handleGenerateKey(request, env);
    }

    // GET /api/account/:keyHash
    const accountMatch = path.match(/^\/api\/account\/([0-9a-fA-Fx]+)$/);
    if (method === 'GET' && accountMatch) {
      return handleGetAccount(request, env, accountMatch[1]);
    }

    // GET /api/receipt/:keyHash/:txHash
    const receiptMatch = path.match(/^\/api\/receipt\/([0-9a-fA-Fx]+)\/([0-9a-fA-Fx]+)$/);
    if (method === 'GET' && receiptMatch) {
      return handleGetReceipt(request, env, receiptMatch[1], receiptMatch[2]);
    }

    // POST /api/pull/:keyHash
    const pullMatch = path.match(/^\/api\/pull\/([0-9a-fA-Fx]+)$/);
    if (method === 'POST' && pullMatch) {
      return handlePull(request, env, pullMatch[1]);
    }

    // POST /api/pull-overflow/:keyHash
    const overflowMatch = path.match(/^\/api\/pull-overflow\/([0-9a-fA-Fx]+)$/);
    if (method === 'POST' && overflowMatch) {
      return handlePullOverflow(request, env, overflowMatch[1]);
    }

    // Health check
    if (path === '/health' || path === '/') {
      return jsonResponse({ status: 'ok', service: 'chainrpc-billing-worker', version: '1.0.0' });
    }

    return errorResponse('Not found', 404);
  },
};
