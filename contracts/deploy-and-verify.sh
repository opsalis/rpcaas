#!/usr/bin/env bash
# Full deploy + verify script for ChainRPCBilling on Demo L2 (845302).
# Testing on Demo L2 (845302). For mainnet: switch to Base (8453).
# Run on CX43 (162.55.167.150) which has Foundry installed.
# Usage: bash deploy-and-verify.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOYER_KEY="0x2ff4dfaff9b15374550dada4b630441246b0598de18a8b771ef8e8ad3054a5f4"
RPC_URL="https://demo.chainrpc.net"
CHAIN_ID=845302
TREASURY="0xFC1f07Dd7233fcc9d36562eCE8D3c1181AEcD2bf"
OPERATOR="0xFC1f07Dd7233fcc9d36562eCE8D3c1181AEcD2bf"
MOCK_USDC="0x75E9b48F4a8f8E10f6d46a7D582aC2bEc85B7d81"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  ChainRPCBilling — Deploy to Demo L2 (845302)        ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "RPC:       $RPC_URL"
echo "Treasury:  $TREASURY"
echo "MockUSDC:  $MOCK_USDC"
echo ""

cd "$SCRIPT_DIR"

# ── Step 1: Compile ──────────────────────────────────────────────────
echo "Step 1/4: Compiling..."
forge build --root . 2>&1 | tail -5
echo "OK"
echo ""

# ── Step 2: Deploy ───────────────────────────────────────────────────
echo "Step 2/4: Deploying..."
DEPLOY_OUT=$(forge create \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_KEY" \
  --chain-id "$CHAIN_ID" \
  ChainRPCBilling.sol:ChainRPCBilling \
  --constructor-args "$TREASURY" "$OPERATOR" \
  2>&1)

echo "$DEPLOY_OUT"

CONTRACT_ADDR=$(echo "$DEPLOY_OUT" | grep -i "Deployed to:" | awk '{print $NF}')
if [ -z "$CONTRACT_ADDR" ]; then
  echo "ERROR: Could not extract deployed address"
  exit 1
fi

echo ""
echo "Contract deployed: $CONTRACT_ADDR (Demo L2 845302)"
echo ""

# ── Step 3: Smoke test — read view functions ──────────────────────────
echo "Step 3/4: Smoke tests..."

# Test: getSubscription for a fake key hash — should return zeros
FAKE_HASH="0x1234567890123456789012345678901234567890123456789012345678901234"

echo "  Reading getSubscription for unknown key (expect zero address)..."
RESULT=$(cast call \
  --rpc-url "$RPC_URL" \
  "$CONTRACT_ADDR" \
  "getSubscription(bytes32)" \
  "$FAKE_HASH" 2>&1)
echo "  Result: $RESULT"

echo "  Reading isKeyRegistered for unknown key (expect false)..."
RESULT2=$(cast call \
  --rpc-url "$RPC_URL" \
  "$CONTRACT_ADDR" \
  "isKeyRegistered(bytes32)" \
  "$FAKE_HASH" 2>&1)
echo "  Result: $RESULT2"

echo "  Reading GROWTH_PRICE (expect 29000000)..."
RESULT3=$(cast call \
  --rpc-url "$RPC_URL" \
  "$CONTRACT_ADDR" \
  "GROWTH_PRICE()" 2>&1)
echo "  Result: $RESULT3"

echo "  Reading PRO_PRICE (expect 99000000)..."
RESULT4=$(cast call \
  --rpc-url "$RPC_URL" \
  "$CONTRACT_ADDR" \
  "PRO_PRICE()" 2>&1)
echo "  Result: $RESULT4"

echo ""
echo "Step 4/4: Registering a test key hash on-chain..."

# Register a test key hash
TEST_KEY="rpk_deadbeef0123456789abcdef01234567"
TEST_HASH=$(echo -n "$TEST_KEY" | sha256sum | awk '{print $1}')
TEST_HASH_HEX="0x$TEST_HASH"

cast send \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_KEY" \
  --chain-id "$CHAIN_ID" \
  "$CONTRACT_ADDR" \
  "registerKey(bytes32)" \
  "$TEST_HASH_HEX" 2>&1

echo "  Test key registered: $TEST_HASH_HEX"

echo "  Verifying registration..."
IS_REG=$(cast call \
  --rpc-url "$RPC_URL" \
  "$CONTRACT_ADDR" \
  "isKeyRegistered(bytes32)" \
  "$TEST_HASH_HEX" 2>&1)
echo "  isKeyRegistered: $IS_REG (expect true/0x1)"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  DEPLOYMENT COMPLETE                                 ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Contract:  $CONTRACT_ADDR"
echo "Chain:     Demo L2 ($CHAIN_ID)"
echo "Explorer:  https://explorer.demo.chainrpc.net/address/$CONTRACT_ADDR"
echo ""
echo "Next steps:"
echo "  1. Update worker/wrangler.toml: BILLING_CONTRACT = \"$CONTRACT_ADDR\""
echo "  2. Deploy worker: cd worker && npx wrangler deploy"
echo "  3. Run integration tests: bash contracts/integration-test.sh $CONTRACT_ADDR"
echo ""
echo "SAVE THIS ADDRESS: $CONTRACT_ADDR"
