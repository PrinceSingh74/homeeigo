# HOMIGO Mobile — Release Readiness Checklist

## Build pipeline
- [ ] `eas.json` present (development / preview / production profiles)
- [ ] EAS project linked: `eas init` + `extra.eas.projectId` in app config
- [ ] `EXPO_PUBLIC_API_URL` set to production API in EAS secrets
- [ ] `EXPO_PUBLIC_RAZORPAY_KEY_ID` matches backend `RAZORPAY_KEY_ID`

## Native modules (requires dev/production build — not Expo Go)
- [ ] `react-native-razorpay` tested on Android dev build
- [ ] iOS Razorpay / payment flow tested if shipping iOS
- [ ] Push notifications tested on dev build (Expo Go skips remote push SDK 53+)

## Push credentials
- [ ] EAS credentials: FCM (Android) configured
- [ ] EAS credentials: APNs (iOS) configured if shipping iOS
- [ ] Backend `expo-server-sdk` can reach Expo push API
- [ ] `expo-notifications` plugin options in `app.json` (icon, color, channels)

## Release signing
- [ ] Android keystore uploaded to EAS or CI
- [ ] iOS distribution cert + provisioning profile (if iOS)
- [ ] Play Console / App Store listing assets ready

## Backend env (production)
- [ ] `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` live keys
- [ ] `RAZORPAY_WEBHOOK_SECRET` configured
- [ ] `MOBILE_DEEP_LINK_BASE=homigo:/` for password reset emails
- [ ] `FRONTEND_URL` for web reset fallback
- [ ] Twilio / SMS for OTP in production
- [ ] Google/Apple OAuth redirect URIs = `homigo://auth/*/callback`

## Pre-release smoke
- [ ] `npm run typecheck` (homigo-mobile)
- [ ] `npx expo-doctor` (homigo-mobile)
- [ ] `bun run scripts/smoke-mobile-production.ts` (apps/backend)
- [ ] Wallet top-up → verify → balance matches DB
- [ ] Completed booking → Rate service → review on provider profile
- [ ] Home → Find pros → provider detail → Book
- [ ] Push on killed app (dev build)
- [ ] Tracking WS with real GPS
