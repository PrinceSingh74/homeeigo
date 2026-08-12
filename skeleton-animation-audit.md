# Skeleton Animation Audit — Web Booking / Wallet

**Scope:** `apps/web` booking, wallet, customer loading states

## Before vs After (`animate-pulse` in booking/wallet paths)

| File | Before | After |
|------|--------|-------|
| `wallet/loading.tsx` | 5× `animate-pulse` | `StaticSkeleton` / `StaticShimmerCard` |
| `wallet/WalletTransactionList.tsx` | 4× `animate-pulse` | `StaticSkeleton` |
| `wallet/WalletPaymentMethodsTab.tsx` | 2× `animate-pulse` | `StaticSkeleton` |
| `wallet/WalletBalanceSection.tsx` | 1× `animate-pulse` overlay | Static gradient |
| `bookings/page.tsx` | 3× `animate-pulse` | `StaticSkeleton` |
| `book/BookPageClient.tsx` | 4× `animate-pulse` | `StaticSkeleton` |
| `RouteLoadingSkeleton.tsx` | 1× `animate-pulse` | `StaticSkeleton` |

**New component:** `apps/web/src/components/ui/StaticSkeleton.tsx` — static placeholder, zero compositor animation.

## Remaining Pulse (Intentional / Out of Scope)

| File | Usage | Notes |
|------|-------|-------|
| `booking/BookingStatusBadge.tsx` | Live status dot | Semantic "active" indicator — 1 node |
| Home/services/profile loaders | Various | Outside booking/wallet mission scope |

## Grep Evidence (Post-Cleanup)

```text
wallet/** animate-pulse: 0 (except none)
bookings/** animate-pulse: 0
book/BookPageClient.tsx animate-pulse: 0
```

## Behavior

1. **No infinite pulse** on wallet/booking loading skeletons.
2. **Static shimmer card** uses gradient only (no animation).
3. Animations stop implicitly when content loads (skeleton unmounts).
4. **No idle compositor activity** from skeleton placeholders in audited paths.

## Certification

| Check | Status |
|-------|--------|
| Booking skeletons static | ✅ |
| Wallet skeletons static | ✅ |
| `animate-ping` removed from loaders | ✅ (none in audited paths) |
| Idle compositor on skeletons | ✅ none |
