/**
 * API key authentication for RPCaaS.
 *
 * Phase 1: In-memory store (sufficient for launch)
 * Phase 2: Redis-backed store
 * Phase 3: On-chain key registry
 */

import * as crypto from 'crypto';

export type Tier = 'free' | 'growth' | 'pro' | 'enterprise';

export interface ApiKeyRecord {
  /** SHA-256 hash of the API key */
  keyHash: string;
  /** Account tier */
  tier: Tier;
  /** Whether the key is active */
  active: boolean;
  /** Creation timestamp (ms) */
  createdAt: number;
  /** Expiration timestamp (ms), 0 = never */
  expiresAt: number;
  /** Optional label for the key */
  label?: string;
}

export interface TierConfig {
  /** Maximum requests per day */
  dailyLimit: number;
  /** Maximum requests per second */
  ratePerSec: number;
  /** Maximum requests per month */
  monthlyLimit: number;
}

export const TIERS: Record<Tier, TierConfig> = {
  free: {
    dailyLimit: 100_000,
    ratePerSec: 10,
    monthlyLimit: 3_000_000,
  },
  growth: {
    dailyLimit: 1_000_000,
    ratePerSec: 50,
    monthlyLimit: 30_000_000,
  },
  pro: {
    dailyLimit: 10_000_000,
    ratePerSec: 200,
    monthlyLimit: 300_000_000,
  },
  enterprise: {
    dailyLimit: Infinity,
    ratePerSec: 1_000,
    monthlyLimit: Infinity,
  },
};

/**
 * Hash an API key for storage. We never store raw keys.
 */
function hashKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Generate a new API key.
 * Format: rpk_<32 hex characters>
 */
export function generateApiKey(): string {
  const random = crypto.randomBytes(16).toString('hex');
  return `rpk_${random}`;
}

/**
 * In-memory API key store.
 * Replace with Redis/DB in production.
 */
class ApiKeyStore {
  private keys = new Map<string, ApiKeyRecord>();

  /**
   * Register a new API key. Returns the raw key (show once, never again).
   */
  register(tier: Tier = 'free', label?: string): string {
    const rawKey = generateApiKey();
    const record: ApiKeyRecord = {
      keyHash: hashKey(rawKey),
      tier,
      active: true,
      createdAt: Date.now(),
      expiresAt: 0,
      label,
    };
    this.keys.set(record.keyHash, record);
    return rawKey;
  }

  /**
   * Validate an API key. Returns the record if valid, null otherwise.
   */
  validate(apiKey: string): ApiKeyRecord | null {
    const hash = hashKey(apiKey);
    const record = this.keys.get(hash);
    if (!record) return null;
    if (!record.active) return null;
    if (record.expiresAt > 0 && Date.now() > record.expiresAt) return null;
    return record;
  }

  /**
   * Deactivate an API key.
   */
  deactivate(apiKey: string): boolean {
    const hash = hashKey(apiKey);
    const record = this.keys.get(hash);
    if (!record) return false;
    record.active = false;
    return true;
  }

  /**
   * Get tier config for an API key.
   */
  getTierConfig(apiKey: string): TierConfig | null {
    const record = this.validate(apiKey);
    if (!record) return null;
    return TIERS[record.tier];
  }

  /**
   * Seed demo keys for development.
   */
  seedDemoKeys(): void {
    // Create one key per tier for testing
    const demoKeys = [
      { tier: 'free' as Tier, label: 'demo-free' },
      { tier: 'growth' as Tier, label: 'demo-growth' },
      { tier: 'pro' as Tier, label: 'demo-pro' },
      { tier: 'enterprise' as Tier, label: 'demo-enterprise' },
    ];
    for (const { tier, label } of demoKeys) {
      const key = this.register(tier, label);
      console.log(`  Demo key (${tier}): ${key}`);
    }
  }

  /**
   * Get total number of registered keys.
   */
  get size(): number {
    return this.keys.size;
  }
}

/** Singleton store instance */
export const apiKeyStore = new ApiKeyStore();
