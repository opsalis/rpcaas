# RPCaaS Business Model

## Product

Multi-chain RPC endpoints for blockchain developers. Customers get an API key and make standard JSON-RPC calls to Base, Optimism, Arbitrum, Polygon, and Ethereum. Pay with USDC. No KYC. No sign-up forms.

## Market

The blockchain RPC market is dominated by a few players who charge premium prices for what is essentially a proxy to full nodes. The infrastructure cost is low but the perceived value is high because running your own full node is operationally complex.

### Competitors

| Provider | Free Tier | Paid Plans | Payment | Notes |
|----------|-----------|------------|---------|-------|
| **Alchemy** | 300M compute units/mo | $49-199/mo | Credit card | Market leader, best dashboard |
| **Infura** | 100K requests/day | $50-200/mo | Credit card | Oldest provider, MetaMask default |
| **QuickNode** | 10M API credits/mo | $49-299/mo | Credit card | Fast, good multi-chain |
| **Ankr** | 30 requests/sec | $49-499/mo | Credit card + crypto | Decentralized angle |
| **Chainstack** | 3M requests/mo | $49-329/mo | Credit card | Enterprise focus |
| **dRPC** | 500K requests/day | Pay-as-you-go | Crypto | Decentralized, usage-based |

### Our Advantages

1. **Cheaper infrastructure**: Built on EUR 17/month Kimsufi servers vs. $500+/month cloud instances
2. **USDC payment**: No credit card required, no KYC, no chargebacks
3. **Anonymous**: No sign-up form, no email, no personal data collected
4. **Shared infrastructure**: Same nodes serve Sertone, L2aaS, Chain Migration — cost is amortized
5. **Developer-first pricing**: Free tier is genuinely useful (100K/day), paid tiers are 5-10x cheaper
6. **No vendor lock-in**: Standard JSON-RPC, same API as every other provider

### Our Disadvantages (Honest Assessment)

1. **Single region**: London only (initially). Competitors have 10+ PoPs globally.
2. **HDD not SSD**: Full nodes on HDD are slower for random reads. Archive queries will be slow.
3. **No dashboard yet**: Competitors have rich analytics dashboards. We start with API keys only.
4. **Unknown brand**: Alchemy has thousands of customers. We have zero.
5. **No archive nodes**: Only full (recent) state. Historical queries fail.

## Pricing

### Tiers

| Tier | Requests/Month | Requests/Day | Rate Limit | Price |
|------|---------------|-------------|------------|-------|
| **Free** | 3,000,000 | 100,000 | 10 req/sec | $0/month |
| **Growth** | 30,000,000 | 1,000,000 | 50 req/sec | $10/month USDC |
| **Pro** | 300,000,000 | 10,000,000 | 200 req/sec | $50/month USDC |
| **Enterprise** | Unlimited | Unlimited | 1,000 req/sec | $200/month USDC |

### Price Comparison (30M requests/month)

| Provider | Price | Our Price | Savings |
|----------|-------|-----------|---------|
| Alchemy (Growth) | $49/mo | $10/mo | 80% cheaper |
| Infura (Developer) | $50/mo | $10/mo | 80% cheaper |
| QuickNode (Build) | $49/mo | $10/mo | 80% cheaper |
| Ankr (Premium) | $49/mo | $10/mo | 80% cheaper |

### Why We Can Be This Cheap

Our marginal cost per customer is near zero:

| Cost Item | Monthly Cost | Per Customer (100 customers) |
|-----------|-------------|------------------------------|
| Kimsufi KS-LE-B (node-uk1) | EUR 17 | EUR 0.17 |
| Cloudflare (free plan) | $0 | $0 |
| k3s cluster (shared) | Already paid | $0 |
| Domain (rpc.opsalis.com) | Already paid | $0 |
| **Total infrastructure** | **~$18** | **~$0.18** |

Even at $10/month with 10 paying customers, we cover infrastructure costs 5x over.

## Revenue Projection

### Year 1 (Conservative)

| Month | Free Users | Paid Users | MRR |
|-------|-----------|-----------|-----|
| 1-3 | 50 | 2 | $40 |
| 4-6 | 100 | 10 | $200 |
| 7-9 | 200 | 25 | $650 |
| 10-12 | 500 | 50 | $1,500 |

Assumptions:
- 5-10% free-to-paid conversion
- Average paid tier: $20/month (mix of Growth and Pro)
- Growth via developer forums, Twitter, word of mouth

### Year 2 (If Product-Market Fit)

| Metric | Value |
|--------|-------|
| Free users | 2,000 |
| Paid users | 200 |
| Average revenue per paid user | $35/month |
| MRR | $7,000 |
| ARR | $84,000 |

## Payment

### USDC Payment Flow

1. Customer visits dashboard, selects tier
2. Dashboard shows USDC payment address (unique per invoice)
3. Customer sends USDC on Base (low fees) or Ethereum
4. Provisioner detects payment, activates API key for 30 days
5. Auto-renewal: customer pre-approves monthly USDC pull (ERC-20 approve)

### Alternative: OPGas Integration

If RPCaaS is tightly integrated with the Opsalis ecosystem:
- Customer buys OPGas credits (same as L2aaS)
- RPCaaS usage deducts from OPGas balance
- Single balance across all Opsalis products
- Volume discounts apply across products

### Revenue Split

RPCaaS is a first-party product (not a marketplace API), so:
- 100% of revenue goes to Mesa Operations LLC
- No 95/5 split (that's for third-party marketplace sellers)
- Infrastructure costs are shared with other first-party products

## Integration Revenue

### Sertone (Wrapper) Cost Savings
- Current: Alchemy free tier (300M compute units)
- If we exceed free tier: $49/month minimum
- With RPCaaS: $0 (internal service, no API key needed)
- Annual savings: up to $588/year

### L2aaS Cross-Sell
- Every L2aaS customer gets a free RPCaaS key
- Value proposition: "Get your own L2 + free reads on Base, Ethereum, Polygon, etc."
- Some L2aaS customers will upgrade to paid RPCaaS for higher limits

### Chain Migration Revenue
- Free migration TO L2aaS chains (customer acquisition)
- Paid migration to external chains: cost + 500% markup
- RPCaaS provides the reads; migration tool provides the writes
- Estimated: $50-500 per migration depending on contract complexity

## Go-to-Market

### Phase 1: Infrastructure (Weeks 1-4)
- Sync all 5 full nodes on node-uk1
- Deploy proxy to k3s
- Launch website on Cloudflare Pages
- Free tier only, no payment yet

### Phase 2: Free Launch (Weeks 5-8)
- Announce on developer forums (Ethereum, Base, Optimism Discord/Telegram)
- Post on Twitter/X with code examples
- List on blockchain RPC comparison sites
- Target: 50 free users

### Phase 3: Paid Launch (Weeks 9-12)
- Enable USDC payment
- Launch Growth and Pro tiers
- Dashboard for usage analytics
- Target: 5 paying customers

### Phase 4: Scale (Months 4-12)
- Add WebSocket support
- Add archive nodes (second server)
- Geographic expansion (US-East node)
- SDK and developer tools
- Target: 50 paying customers

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Nodes fall out of sync | Service outage | Monitoring + alerts, auto-restart |
| HDD too slow for RPC | Poor latency | Upgrade to SSD if revenue justifies |
| Disk fills up | Node stops | Pruning config, monitoring, 85% alert |
| Alchemy drops prices | Less competitive | Our cost base is so low we can match anything |
| Zero customers | Wasted effort | Infrastructure serves other products regardless |
| USDC payment friction | Fewer conversions | Add credit card via Coinbase Onramp later |

## Key Metric

The single most important metric: **paid customers**. Everything else (free users, requests, uptime) is a leading indicator. If we cannot convert free users to paid, the product has no standalone value — but still provides value as internal infrastructure for Sertone, L2aaS, and Chain Migration.
