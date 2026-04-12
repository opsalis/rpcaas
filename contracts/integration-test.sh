#!/usr/bin/env bash
# Integration tests for ChainRPCBilling on Demo L2 (845302).
# Testing on Demo L2 (845302). For mainnet: switch to Base (8453).
# Tests: 3 keys (free, Growth, Pro), subscribe, pull, overflow charge.
# Run AFTER deploy-and-verify.sh, pass contract address as $1.
#
# Usage: bash integration-test.sh <CONTRACT_ADDRESS>
set -euo pipefail

CONTRACT_ADDR="${1:-}"
if [ -z "$CONTRACT_ADDR" ]; then
  echo "Usage: $0 <CONTRACT_ADDRESS>"
  exit 1
fi

DEPLOYER_KEY="0x2ff4dfaff9b15374550dada4b630441246b0598de18a8b771ef8e8ad3054a5f4"
RPC_URL="https://demo.chainrpc.net"
CHAIN_ID=845302
MOCK_USDC="0x75E9b48F4a8f8E10f6d46a7D582aC2bEc85B7d81"
DEPLOYER_ADDR="0xFC1f07Dd7233fcc9d36562eCE8D3c1181AEcD2bf"

PASS=0
FAIL=0

check() {
  local desc="$1"
  local result="$2"
  local expect="$3"
  if echo "$result" | grep -qi "$expect"; then
    echo "  PASS: $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $desc"
    echo "        Expected: $expect"
    echo "        Got:      $result"
    FAIL=$((FAIL+1))
  fi
}

echo "╔══════════════════════════════════════════════════════╗"
echo "║  ChainRPCBilling — Integration Tests (Demo L2 845302)║"
echo "╚══════════════════════════════════════════════════════╝"
echo "Contract: $CONTRACT_ADDR"
echo ""

# ── Helper: compute SHA-256 key hash ────────────────────────────────

keyhash() {
  local key="$1"
  echo "0x$(echo -n "$key" | sha256sum | awk '{print $1}')"
}

# ── Generate 3 test keys ─────────────────────────────────────────────
KEY_FREE="rpk_test_free_00000000000000000001"
KEY_GROWTH="rpk_test_growth_0000000000000002"
KEY_PRO="rpk_test_pro_000000000000000003"

HASH_FREE=$(keyhash "$KEY_FREE")
HASH_GROWTH=$(keyhash "$KEY_GROWTH")
HASH_PRO=$(keyhash "$KEY_PRO")

echo "Test keys:"
echo "  Free:   $KEY_FREE → $HASH_FREE"
echo "  Growth: $KEY_GROWTH → $HASH_GROWTH"
echo "  Pro:    $KEY_PRO → $HASH_PRO"
echo ""

# ── Test 1: Register all 3 keys ───────────────────────────────────────
echo "=== Test 1: Register keys ==="

for hash in "$HASH_FREE" "$HASH_GROWTH" "$HASH_PRO"; do
  cast send \
    --rpc-url "$RPC_URL" \
    --private-key "$DEPLOYER_KEY" \
    --chain-id "$CHAIN_ID" \
    "$CONTRACT_ADDR" \
    "registerKey(bytes32)" \
    "$hash" --quiet 2>&1
done

for key in "$KEY_FREE" "$KEY_GROWTH" "$KEY_PRO"; do
  hash=$(keyhash "$key")
  result=$(cast call --rpc-url "$RPC_URL" "$CONTRACT_ADDR" "isKeyRegistered(bytes32)" "$hash")
  check "Key registered: ${key:0:20}..." "$result" "0x0000000000000000000000000000000000000000000000000000000000000001"
done

echo ""

# ── Test 2: Check no subscription for free key ────────────────────────
echo "=== Test 2: Free key has no subscription ==="
result=$(cast call --rpc-url "$RPC_URL" "$CONTRACT_ADDR" "getSubscription(bytes32)" "$HASH_FREE")
# wallet should be zero address
check "Free key: no wallet" "$result" "0000000000000000000000000000000000000000"

echo ""

# ── Test 3: Subscribe Growth key ──────────────────────────────────────
echo "=== Test 3: Subscribe Growth key ==="
echo "  Checking MockUSDC balance..."
BALANCE=$(cast call --rpc-url "$RPC_URL" "$MOCK_USDC" "balanceOf(address)" "$DEPLOYER_ADDR" 2>&1)
echo "  Balance (raw): $BALANCE"

echo "  Approving 100 USDC for billing contract..."
cast send \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_KEY" \
  --chain-id "$CHAIN_ID" \
  "$MOCK_USDC" \
  "approve(address,uint256)" \
  "$CONTRACT_ADDR" "100000000" --quiet 2>&1

echo "  Subscribing to Growth (tier=1)..."
TX_SUB=$(cast send \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_KEY" \
  --chain-id "$CHAIN_ID" \
  "$CONTRACT_ADDR" \
  "subscribe(bytes32,address,uint8)" \
  "$HASH_GROWTH" "$MOCK_USDC" "1" 2>&1)
echo "  Subscribe TX: $(echo "$TX_SUB" | grep -i "transactionHash" | head -1)"

echo "  Verifying subscription..."
SUB_RESULT=$(cast call --rpc-url "$RPC_URL" "$CONTRACT_ADDR" "getSubscription(bytes32)" "$HASH_GROWTH")
check "Growth: has wallet" "$SUB_RESULT" "${DEPLOYER_ADDR:2}"
check "Growth: active" "$SUB_RESULT" "0000000000000000000000000000000000000000000000000000000000000001"

echo ""

# ── Test 4: Subscribe Pro key ─────────────────────────────────────────
echo "=== Test 4: Subscribe Pro key ==="
echo "  Approving 200 USDC..."
cast send \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_KEY" \
  --chain-id "$CHAIN_ID" \
  "$MOCK_USDC" \
  "approve(address,uint256)" \
  "$CONTRACT_ADDR" "200000000" --quiet 2>&1

echo "  Subscribing to Pro (tier=2)..."
cast send \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_KEY" \
  --chain-id "$CHAIN_ID" \
  "$CONTRACT_ADDR" \
  "subscribe(bytes32,address,uint8)" \
  "$HASH_PRO" "$MOCK_USDC" "2" --quiet 2>&1

SUB_PRO=$(cast call --rpc-url "$RPC_URL" "$CONTRACT_ADDR" "getSubscription(bytes32)" "$HASH_PRO")
check "Pro: has wallet" "$SUB_PRO" "${DEPLOYER_ADDR:2}"

echo ""

# ── Test 5: Pull subscription for Growth ──────────────────────────────
echo "=== Test 5: Pull monthly subscription (Growth) ==="
echo "  Re-approving for next pull (need more allowance)..."
cast send \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_KEY" \
  --chain-id "$CHAIN_ID" \
  "$MOCK_USDC" \
  "approve(address,uint256)" \
  "$CONTRACT_ADDR" "1000000000" --quiet 2>&1

echo "  Pulling Growth subscription..."
PULL_TX=$(cast send \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_KEY" \
  --chain-id "$CHAIN_ID" \
  "$CONTRACT_ADDR" \
  "pull(bytes32)" \
  "$HASH_GROWTH" 2>&1)
echo "  Pull TX: $(echo "$PULL_TX" | grep -i "blockNumber\|transactionHash" | head -2)"

# Verify subscription still active
STILL_ACTIVE=$(cast call --rpc-url "$RPC_URL" "$CONTRACT_ADDR" "getSubscription(bytes32)" "$HASH_GROWTH")
check "Growth: still active after pull" "$STILL_ACTIVE" "0000000000000000000000000000000000000000000000000000000000000001"

echo ""

# ── Test 6: Charge overflow for Growth ────────────────────────────────
echo "=== Test 6: Charge overflow ($5 = 5_000000) ==="
cast send \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_KEY" \
  --chain-id "$CHAIN_ID" \
  "$CONTRACT_ADDR" \
  "pullOverflow(bytes32,uint256)" \
  "$HASH_GROWTH" "5000000" --quiet 2>&1

AFTER_OVERFLOW=$(cast call --rpc-url "$RPC_URL" "$CONTRACT_ADDR" "getSubscription(bytes32)" "$HASH_GROWTH")
check "Growth: still active after overflow" "$AFTER_OVERFLOW" "0000000000000000000000000000000000000000000000000000000000000001"

echo ""

# ── Test 7: Free key has no subscription (sanity check) ───────────────
echo "=== Test 7: Free key still free (no subscription) ==="
FREE_SUB=$(cast call --rpc-url "$RPC_URL" "$CONTRACT_ADDR" "getSubscription(bytes32)" "$HASH_FREE")
check "Free key: wallet is zero" "$FREE_SUB" "000000000000000000000000000000000000000000000000000000000000000000000000"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Results: PASS=$PASS  FAIL=$FAIL                    "
echo "╚══════════════════════════════════════════════════════╝"

if [ $FAIL -gt 0 ]; then
  echo "SOME TESTS FAILED. Review output above."
  exit 1
else
  echo "ALL TESTS PASSED."
fi
