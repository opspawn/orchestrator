<!-- Updated by system at 2026-02-06T07:41:48.711Z -->
# Payment System

## Architecture
- Direct USDC monitoring on Polygon (no third-party gateway)
- Unique invoice amounts for payment reconciliation
- Background poller checks every 30 seconds
- Auto-generates API keys on payment confirmation

## Endpoints (SnapAPI)
- POST /api/subscribe - Create invoice {plan, email}
- GET /api/subscribe/:id - Check payment status
- GET /api/pricing - List plans

## Plans
- Pro: $10/mo + offset, 1000 captures
- Enterprise: $50/mo + offset, 10000 captures

## Technical Details
- USDC contract: 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
- Wallet: 0x7483a9F237cf8043704D6b17DA31c12BfFF860DD
- Payment matching: unique cent offsets (0.01-0.99)
- Tolerance: 0.001 USDC for matching
- Expiry: 1 hour per invoice
