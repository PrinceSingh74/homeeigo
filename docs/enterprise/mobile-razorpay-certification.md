# HOMIGO — Mobile Razorpay Certification

**Date:** 2026-06-25 · **Status: BLOCKED.**

## Verdict: **BLOCKED — requires a release/dev-client build on a physical device + live Razorpay test-mode keys.**

The mobile app uses `react-native-razorpay` (the native checkout SDK). A real payment can only execute
inside a native build on a device — it cannot run in `expo export` / Metro / this environment.

| Check | Status | Blocker |
|---|---|---|
| Payment success (real txn) | BLOCKED | native build + Razorpay test keys on device |
| Failure / retry | BLOCKED | same |
| Refund | BLOCKED | same + admin/refund flow |
| Duplicate payment prevention | **server-side PASS** | DB shows 0 duplicate `razorpay_payment_id`, 0 double-capture (see `homigo-end-to-end-business-certification.md`) |
| Ledger after payment | **server-side PASS** | ledger debit==credit, 0 mismatch |

## Known engineering risk (must be confirmed on-device)
`react-native-razorpay` is flagged **"Unsupported on New Architecture"** by expo-doctor, while
`newArchEnabled:true`. This **must** be validated on a real New-Arch build — payments may need a
New-Arch-compatible integration (e.g. checkout via `expo-web-browser`) if the native SDK misbehaves.

## To clear
1. `eas build` a dev/release client (needs **EAS account**). 2. Set **Razorpay test-mode** key in env.
3. On a device: run success → failure → retry → refund; assert 1 `payments` row per attempt, 0 duplicates,
   ledger balanced after each. 4. Confirm New-Arch compatibility.

> **BLOCKED.** Server-side payment integrity is proven (0 duplicates / 0 orphans / balanced ledger), but
> a real mobile transaction cannot be executed without a device build + Razorpay keys.
