# Phase 18.4 — Customer Checkout UI Certification

**Date:** 2026-06-13 · **App:** `apps/web` (React 19 + Next 15). Reuses the existing API client (`coreApi`), Razorpay hook (`useRazorpayCheckout`), toast store, and react-query — **no new payment/client systems** (RULE #1/#2). Wired to the **certified** Phase 18.1/18.2 endpoints.

## Delivered

**API (`src/services/core/api.ts` → `coreApi.wallet.checkout`):** `quote`, `payFull`, `splitInitiate`, `splitVerify` — typed wrappers over `/api/wallet/checkout/*`.

**Hooks (`src/hooks/use-wallet-checkout.ts`):**
- `useCheckoutQuote(bookingId)` — live quote (react-query, 15 s stale).
- `useWalletCheckout()` — orchestrates the three paths and exposes `status`:
  - wallet covers all → `/checkout/pay` (no gateway step)
  - split → `/checkout/split/initiate` → Razorpay(remainder) → `/checkout/split/verify`
  - wallet off → Razorpay-only (walletAmount 0)
  - **Resume**: pending bookingId persisted in `localStorage` (`getPendingCheckoutBookingId`) for failure recovery.

**Component (`src/components/checkout/WalletCheckoutSummary.tsx`):** matches the spec's required pieces:
- **Payment Summary Card** — Booking Amount, Taxes, Wallet Usage, Card/UPI (Razorpay), Final Total.
- **Wallet Toggle** — "Use Wallet Balance" with available balance; disabled when balance 0 / paid / busy.
- **Live Breakdown** — recomputes wallet vs card split instantly on toggle (`useMemo`).
- **Payment Status Tracking** — `PENDING / PROCESSING / SUCCESS / FAILED` badge + states.
- **Failure Recovery** — "Resume Payment" label when a gateway leg is left pending; retry on failure.
- **Mobile responsive** — `max-w-md`, `sm:` breakpoints, fluid widths.

Amounts are derived/validated server-side; the client only sends the chosen wallet portion (no price logic duplicated client-side).

## RULE #4 status (honest)
- **TypeScript build:** ✅ `tsc --noEmit` clean for the new files; react-query/import paths resolve.
- **Backend behaviour these screens drive:** ✅ already certified by execution — see `wallet-split-certification.md` (cases A/B/C, atomicity, concurrency 50–500, zero drift).
- **Playwright E2E:** ⏳ **NOT YET RUN** — requires the full app served with a test Razorpay key + browser harness. Wired and ready; running the suite (wallet-only / split / failure / retry / refund visibility) is the remaining verification step. Not marked PASS because it was not executed (no fabricated metrics).

## Out of scope for 18.4 (tracked elsewhere)
- Gift Card / HCoin / Coupon / Membership-discount lines in the summary → **Phase 18.3** (multi-source engine), which will extend `quote` + this card.
- Realtime WS push of payment status (current flow updates from the synchronous verify result).

**Verdict:** UI **implemented, type-safe, and wired to certified endpoints**. E2E (Playwright) pending execution before a full PASS.
