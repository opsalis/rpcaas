# Crypto Onramp Providers (Non-US Alternatives)

Research date: 2026-04-09

## Goal

Find non-US crypto onramp providers that support credit card to USDC conversion.
These replace Coinbase Onramp for customers outside US regulatory reach.

## Provider Comparison

| Provider | HQ Country | Card→USDC | Widget/API | Fees (card) | Non-US? | Notes |
|----------|-----------|-----------|------------|-------------|---------|-------|
| **Transak** | UK | Yes | Widget + SDK + API | 1.5-5.5% | YES | FCA-regulated, 64 countries, 136 cryptos |
| **Ramp Network** | UK (London) | Yes | Widget + SDK + API | 0.49-2.9% | YES | 150+ countries, partner commission program |
| **Alchemy Pay** | Singapore | Yes | Widget + API | ~3.5% (promo: 0%) | YES | 173 countries, Apple/Google Pay, strong Asia coverage |
| **Banxa** | Australia (Melbourne) | Yes | Widget + API | 1.5-3% | YES | Acquired by OSL Group Jan 2026, EU HQ Amsterdam |
| **Simplex** | Israel | Yes | Widget + API | 2.5-5% | YES | Acquired by Nuvei 2021, zero chargeback guarantee |
| **Mercuryo** | UK (London) | Yes | Widget + API | 2.5-3.95% | YES | Also registered Estonia/Lithuania |
| **Onramper** | Netherlands | Yes (aggregator) | Widget + API | Aggregates others | YES | Routes to cheapest provider per transaction |
| **MoonPay** | USA (Miami/NYC) | Yes | Widget + API | 3.5-4.5% | NO | Moved HQ to NYC April 2025 |
| **Sardine** | USA (San Francisco) | Yes | Widget + API | ~2-3% | NO | Fraud/compliance focused |
| **Wert** | USA/Estonia | Yes | Widget + API | ~3-4% | PARTIAL | US entity (SHA2 Solutions Inc) + Estonia entity |

## Top 2 Recommendations (Non-US)

### 1. Transak (UK)

- **Why:** FCA-regulated, purpose-built for developer integration, excellent documentation, supports USDC on multiple chains (Base, Polygon, Arbitrum, Optimism, Ethereum). Widget is white-label and customizable.
- **Integration:** JavaScript SDK, iframe widget, or REST API. Webhook callbacks for transaction status.
- **Fees:** 1.5-3.5% for card payments, lower for bank transfers (0.99-1.5%).
- **Coverage:** 64 countries, 136 cryptocurrencies, multiple payment methods per region.
- **USDC support:** Direct USDC purchase on Base, Polygon, Arbitrum, Optimism, Ethereum L1.
- **Docs:** https://docs.transak.com

### 2. Ramp Network (UK)

- **Why:** Lowest baseline fees (0.49-2.9%), 150+ countries, strong partner program with custom fee structures for volume. Excellent widget UX. Supports direct USDC output.
- **Integration:** Lightweight widget (few lines of code), SDK, or full API. Handles all KYC/AML.
- **Fees:** 0.49-2.9% depending on method and region. Volume discounts available.
- **Coverage:** 150+ countries, supports Visa/Mastercard, Apple Pay, bank transfers, local methods.
- **USDC support:** Direct USDC purchase on multiple L2s including Base, Optimism, Arbitrum.
- **Docs:** https://docs.ramp.network

### Honorable Mention: Onramper (Netherlands)

- **Why:** Aggregator that routes through multiple providers (including Transak and Ramp). Single integration, always gets the cheapest rate for each transaction. Good for maximizing conversion across geographies.
- **Trade-off:** Extra abstraction layer, slightly less control over UX.
- **Docs:** https://docs.onramper.com

## Implementation Plan

1. Integrate Transak widget as primary (best docs, FCA regulated)
2. Add Ramp Network as secondary/fallback (lowest fees)
3. Consider Onramper aggregator if we want automatic routing between providers
4. All three are non-US, support USDC on L2s, and handle KYC/AML themselves

## Key Decision Points

- **No KYC burden on us:** All recommended providers handle KYC/AML internally.
- **USDC on Base:** Both Transak and Ramp support direct USDC purchase on Base chain, which is our settlement layer.
- **Revenue share:** Both offer partner commission (we earn a cut of their fee on each transaction).
- **No US regulatory exposure:** All HQ'd outside the US (UK, Netherlands, Singapore).
