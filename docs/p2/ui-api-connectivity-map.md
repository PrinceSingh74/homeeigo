# UI → API → Service → DB Connectivity Map (Phases 16/17/18)

| UI Component / Screen | API client | Route | Service | DB table(s) | Status |
|---|---|---|---|---|---|
| AddAddressModal (AddressSearchInput, CurrentLocationButton) | coreApi.geo.autocomplete/reverse/place | /api/geo/autocomplete,reverse,place | maps.service | (Google proxy) | ✅ |
| AddAddressModal save | coreApi.users.createAddress | /api/users/addresses | address svc | addresses | ✅ |
| BookPageClient → ProviderETA | coreApi.geo.nearbyProviders | /api/geo/nearby-providers | matching.service | providers, locations | ✅ |
| BookingDetailModal → CustomerTrackingMap | useBookingTracking + coreApi.tracking.get | /ws/tracking/:id, /api/tracking/:id | tracking.service | tracking, location_history | ✅ |
| BookingDetailModal → WalletCheckoutSummary | coreApi.wallet.checkout.* | /api/wallet/checkout/{quote,pay,split,multi-source} | wallet-checkout.service | wallet_transactions, journal_entries, payments | ✅ |
| Admin Operations (operations/page) | adminApi.opsMap | /api/admin/ops-map | ops-map.service | providers, locations, bookings, geofences | ✅ |
| Admin Heatmap (heatmap/page) | adminApi.heatmap | /api/admin/heatmap | heatmap.service | bookings, addresses, providers, locations | ✅ |
| Admin Geofences (geofences/page) | adminApi.geofences.* | /api/geo/geofences, /api/geo/geofence-events | geofence.service | geofences, geofence_events | ✅ |
| Partner location update | (partner app) | /ws/tracking/:id, /api/tracking/location | tracking.service | location_history, tracking | ✅ |
| Partner route optimize | — (no screen) | /api/providers/me/route/optimize | route-optimization.service | bookings, locations | 🟡 API only |

RBAC: /api/admin/* (admin RBAC plugin, ANALYTICS:READ for ops-map/heatmap), /api/geo/geofences* (requireRole ADMIN), tracking room (canAccessBookingWs). All verified live (200 admin / 403 customer / 401 anon).
