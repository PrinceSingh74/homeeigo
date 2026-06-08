# HOMIGO Part 3 Curl Smoke Collection

Base URL:

```bash
export BASE_URL="http://localhost:3000"
```

Windows PowerShell:

```powershell
$env:BASE_URL="http://localhost:3000"
```

## 1) Health + Swagger

```bash
curl -i "$BASE_URL/health"
curl -i "$BASE_URL/swagger/json"
```

## 2) Login (seed user) and token

```bash
curl -i -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"customer@homigo.demo","password":"Homigo@123","setAuthCookies":false}'
```

Copy `accessToken` from response and set:

```bash
export TOKEN="<paste_access_token>"
```

PowerShell:

```powershell
$env:TOKEN="<paste_access_token>"
```

## 3) Core protected endpoints

```bash
curl -i "$BASE_URL/api/users/me" -H "Authorization: Bearer $TOKEN"
curl -i "$BASE_URL/api/users/addresses" -H "Authorization: Bearer $TOKEN"
curl -i "$BASE_URL/api/users/bookings?status=all&limit=5&page=1" -H "Authorization: Bearer $TOKEN"
curl -i "$BASE_URL/api/payments/history?limit=5&page=1" -H "Authorization: Bearer $TOKEN"
curl -i "$BASE_URL/api/wallet/balance" -H "Authorization: Bearer $TOKEN"
curl -i "$BASE_URL/api/notifications?limit=5&page=1" -H "Authorization: Bearer $TOKEN"
```

## 4) Public/search endpoints

```bash
curl -i "$BASE_URL/api/services?page=1&limit=5"
curl -i "$BASE_URL/api/services/featured"
curl -i "$BASE_URL/api/services/category/cleaning?page=1&limit=5"
curl -i -X POST "$BASE_URL/api/services/search" \
  -H "Content-Type: application/json" \
  -d '{"q":"cleaning","city":"Mumbai"}'
curl -i "$BASE_URL/api/providers/nearby?latitude=19.076&longitude=72.8777&radius=5&limit=5"
```

## 5) Route existence checks (non-happy-path)

```bash
curl -i "$BASE_URL/api/bookings/non-existent-id" -H "Authorization: Bearer $TOKEN"
curl -i "$BASE_URL/api/ratings/non-existent-booking" -H "Authorization: Bearer $TOKEN"
curl -i "$BASE_URL/api/tracking/non-existent-id" -H "Authorization: Bearer $TOKEN"
curl -i "$BASE_URL/api/admin/dashboard" -H "Authorization: Bearer $TOKEN"
```

## 6) WebSocket routes

Install `wscat` if needed:

```bash
npm i -g wscat
```

Tracking:

```bash
wscat -c "ws://localhost:3000/ws/tracking/non-existent-id?token=$TOKEN"
```

Notifications:

```bash
wscat -c "ws://localhost:3000/ws/notifications?token=$TOKEN"
```

## 7) One-shot automated smoke run (recommended)

```bash
bun run smoke:part3
```

If seed login is different:

```bash
SMOKE_EMAIL="your-user@email.com" SMOKE_PASSWORD="your-pass" bun run smoke:part3
```
