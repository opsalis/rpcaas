# RPCaaS Provisioner

Auto-creates API keys when USDC payment is detected.

## Status: Future Development

The provisioner will:

1. Watch for USDC transfers to the RPCaaS payment address on Base
2. Match payments to customer requests (via memo or unique address)
3. Create an API key with the appropriate tier
4. Return the API key to the customer via the dashboard

## Planned Architecture

```
Customer → Dashboard → "Pay $10/month for Growth tier"
                          ↓
                     Generate unique USDC payment address
                          ↓
Customer → Sends USDC on Base to payment address
                          ↓
Provisioner → Detects USDC transfer via event listener
                          ↓
             Creates API key (Growth tier, 30-day expiry)
                          ↓
             Returns key to dashboard → Customer copies key
```

## For Now

API keys are created manually via the proxy's demo seed mechanism or future admin endpoint.

## Integration

- Uses the same USDC payment flow as L2aaS
- Same Base chain for payments (low fees)
- Could share the same Coinbase Onramp widget
