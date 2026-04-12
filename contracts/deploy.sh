#!/usr/bin/env bash
# Deploy ChainRPCBilling to Demo L2 (845302) using Foundry.
# Testing on Demo L2 (845302). For mainnet: switch to Base (8453).
# Run from the contracts/ directory on a machine with Foundry installed (CX43).
set -euo pipefail

DEPLOYER_KEY="0x2ff4dfaff9b15374550dada4b630441246b0598de18a8b771ef8e8ad3054a5f4"
RPC_URL="https://demo.chainrpc.net"
CHAIN_ID=845302

# Treasury = deployer address (for test; replace with Tangem on mainnet)
TREASURY="0xFC1f07Dd7233fcc9d36562eCE8D3c1181AEcD2bf"
OPERATOR="0xFC1f07Dd7233fcc9d36562eCE8D3c1181AEcD2bf"

echo "=== Deploying ChainRPCBilling to Demo L2 (845302) ==="
echo "RPC:       $RPC_URL"
echo "Treasury:  $TREASURY"
echo "Operator:  $OPERATOR"
echo ""

# Compile first
forge build --root . 2>/dev/null || true

# Deploy using forge create
DEPLOY_OUTPUT=$(forge create \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_KEY" \
  --chain-id "$CHAIN_ID" \
  ChainRPCBilling.sol:ChainRPCBilling \
  --constructor-args "$TREASURY" "$OPERATOR" \
  --broadcast 2>&1)

echo "$DEPLOY_OUTPUT"

# Extract deployed address
ADDR=$(echo "$DEPLOY_OUTPUT" | grep -i "Deployed to:" | awk '{print $NF}')
if [ -z "$ADDR" ]; then
  ADDR=$(echo "$DEPLOY_OUTPUT" | grep -i "contract address" | awk '{print $NF}')
fi

echo ""
echo "=== DEPLOYED ==="
echo "Contract: $ADDR"
echo "Chain:    Demo L2 (845302)"
echo "Explorer: https://explorer.demo.chainrpc.net/address/$ADDR"
echo ""
echo "Save this address to worker/wrangler.toml as BILLING_CONTRACT"
