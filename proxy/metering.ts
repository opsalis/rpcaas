/**
 * Request metering and rate limiting for RPCaaS.
 *
 * Phase 1: In-memory counters (current)
 * Phase 2: Redis counters (horizontal scaling)
 * Phase 3: On-chain metering (trustless billing)
 */

import { Tier, TIERS } from './auth';

interface MeterEntry {
  /** Requests today */
  dailyCount: number;
  /** Requests this month */
  monthlyCount: number;
  /** Timestamp of last daily reset */
  lastDailyReset: number;
  /** Timestamp of last monthly reset */
  lastMonthlyReset: number;
  /** Sliding window: timestamps of recent requests (for per-second rate limiting) */
  recentRequests: number[];
}

export interface MeterResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Reason for rejection (if not allowed) */
  reason?: 'daily_limit' | 'monthly_limit' | 'rate_limit' | 'unknown';
  /** Remaining daily requests */
  dailyRemaining: number;
  /** Daily limit for this tier */
  dailyLimit: number;
  /** Remaining monthly requests */
  monthlyRemaining: number;
  /** Timestamp when daily counter resets (Unix seconds) */
  resetAt: number;
}

class MeteringService {
  private meters = new Map<string, MeterEntry>();

  /**
   * Get or create a meter entry for an API key.
   */
  private getEntry(apiKey: string): MeterEntry {
    let entry = this.meters.get(apiKey);
    if (!entry) {
      entry = {
        dailyCount: 0,
        monthlyCount: 0,
        lastDailyReset: this.startOfDay(),
        lastMonthlyReset: this.startOfMonth(),
        recentRequests: [],
      };
      this.meters.set(apiKey, entry);
    }
    // Check if we need to reset daily counter
    const dayStart = this.startOfDay();
    if (entry.lastDailyReset < dayStart) {
      entry.dailyCount = 0;
      entry.lastDailyReset = dayStart;
    }
    // Check if we need to reset monthly counter
    const monthStart = this.startOfMonth();
    if (entry.lastMonthlyReset < monthStart) {
      entry.monthlyCount = 0;
      entry.lastMonthlyReset = monthStart;
    }
    return entry;
  }

  /**
   * Check if a request is allowed and increment counters if so.
   * This is atomic: check + increment in one call.
   */
  check(apiKey: string, tier: Tier): MeterResult {
    const config = TIERS[tier];
    const entry = this.getEntry(apiKey);
    const now = Date.now();

    // Clean old entries from sliding window (older than 1 second)
    entry.recentRequests = entry.recentRequests.filter(t => now - t < 1000);

    // Check per-second rate limit
    if (entry.recentRequests.length >= config.ratePerSec) {
      return {
        allowed: false,
        reason: 'rate_limit',
        dailyRemaining: Math.max(0, config.dailyLimit - entry.dailyCount),
        dailyLimit: config.dailyLimit,
        monthlyRemaining: Math.max(0, config.monthlyLimit - entry.monthlyCount),
        resetAt: this.endOfDay(),
      };
    }

    // Check daily limit
    if (entry.dailyCount >= config.dailyLimit) {
      return {
        allowed: false,
        reason: 'daily_limit',
        dailyRemaining: 0,
        dailyLimit: config.dailyLimit,
        monthlyRemaining: Math.max(0, config.monthlyLimit - entry.monthlyCount),
        resetAt: this.endOfDay(),
      };
    }

    // Check monthly limit
    if (entry.monthlyCount >= config.monthlyLimit) {
      return {
        allowed: false,
        reason: 'monthly_limit',
        dailyRemaining: 0,
        dailyLimit: config.dailyLimit,
        monthlyRemaining: 0,
        resetAt: this.endOfDay(),
      };
    }

    // Allowed — increment all counters
    entry.dailyCount++;
    entry.monthlyCount++;
    entry.recentRequests.push(now);

    return {
      allowed: true,
      dailyRemaining: Math.max(0, config.dailyLimit - entry.dailyCount),
      dailyLimit: config.dailyLimit,
      monthlyRemaining: Math.max(0, config.monthlyLimit - entry.monthlyCount),
      resetAt: this.endOfDay(),
    };
  }

  /**
   * Get current usage stats for an API key (without incrementing).
   */
  getUsage(apiKey: string, tier: Tier): Omit<MeterResult, 'allowed' | 'reason'> {
    const config = TIERS[tier];
    const entry = this.getEntry(apiKey);
    return {
      dailyRemaining: Math.max(0, config.dailyLimit - entry.dailyCount),
      dailyLimit: config.dailyLimit,
      monthlyRemaining: Math.max(0, config.monthlyLimit - entry.monthlyCount),
      resetAt: this.endOfDay(),
    };
  }

  /** Start of current UTC day in milliseconds */
  private startOfDay(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  /** End of current UTC day in Unix seconds */
  private endOfDay(): number {
    const now = new Date();
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return Math.floor(end / 1000);
  }

  /** Start of current UTC month in milliseconds */
  private startOfMonth(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  }

  /** Total number of tracked API keys */
  get size(): number {
    return this.meters.size;
  }
}

/** Singleton metering instance */
export const metering = new MeteringService();
