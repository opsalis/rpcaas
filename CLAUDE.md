# CLAUDE.md — RPCaaS Project Rules

> RPC-as-a-Service: Multi-chain RPC endpoints for L2 developers.

## Overview
RPCaaS provides managed RPC endpoints for Base, Optimism, Arbitrum, Polygon, and Ethereum. Customers get an API key and call `https://rpc.opsalis.com/v1/{chain}/{apiKey}`. The proxy routes to our full nodes and meters usage.

## Architecture
- **Proxy** (`proxy/`): Node.js Express proxy — authenticates, rate-limits, meters, forwards JSON-RPC to chain nodes
- **Nodes** (`nodes/`): Helm charts for full nodes (one per chain) running on node-uk1 (London, Kimsufi)
- **Website** (`website/`): Cloudflare Pages landing page, docs, dashboard
- **Provisioner** (`provisioner/`): Auto-creates API keys on USDC payment

## Infrastructure
- Full nodes run on node-uk1 (Kimsufi KS-LE-B, London, 2x2TB HDD)
- Proxy runs on k3s cluster
- All nodes are full nodes (not archive) to keep disk manageable
- Chain data on /dev/sdb (2TB), OS + L1 on /dev/sda (2TB)

## Rules
1. Read this file and ARCHITECTURE.md before any work
2. Never commit credentials or API keys
3. Never expose internal node IPs or k8s service names in public docs
4. All pricing is in USDC
5. No KYC required — anonymous API keys
6. Follow the Opsalis naming convention: never say "wrapper" or "node" publicly
7. Architecture first, code second

## Integration Points
- Sertone (wrapper) replaces Alchemy with our RPC endpoints
- L2aaS customers get free RPC access to read other chains
- Chain Migration reads from our full nodes
- Same k3s cluster and OVH infrastructure as other Opsalis products

## Tech Stack
- Proxy: Node.js + TypeScript + Express
- Nodes: Official Docker images via Helm charts on k3s
- Website: Static HTML + Tailwind CSS on Cloudflare Pages
- Metering: In-memory initially, Redis later, on-chain eventually
