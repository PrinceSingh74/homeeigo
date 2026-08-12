# CDN (Cloudflare) + Redis Sentinel — Configuration

## CDN — Cloudflare (edge cache + static optimization + global LB)
```
# wrangler / dashboard config (illustrative)
Zone: homigo.in
DNS:  app.homigo.in  → CNAME → k8s ingress LB (proxied, orange-cloud ON)
      api.homigo.in  → CNAME → k8s ingress LB (proxied)

Cache Rules:
  /_next/static/*        → Cache Everything, Edge TTL 1y, immutable
  /images/*, /assets/*   → Cache Everything, Edge TTL 30d, Polish=lossy, WebP auto
  /api/services*         → Edge TTL 60s (matches backend cache), respect origin headers
  /api/weather/*         → bypass cache (backend already Redis-caches 10m)
  /api/* (default)       → bypass (dynamic)

Optimization:
  Auto Minify: JS/CSS/HTML       Brotli: ON       HTTP/3 + 0-RTT: ON
  Tiered Cache: ON (Smart)       Argo Smart Routing: ON
  Polish (image): Lossy + WebP   Mirage (mobile images): ON

Security at edge:
  WAF: OWASP managed ruleset ON
  Rate limiting: 1000 req/min/IP on /api/*  (complements in-app limiter)
  Bot Fight Mode: ON             Always Use HTTPS: ON

Global LB (Cloudflare Load Balancing):
  Pools: ap-south-1 (Mumbai, primary), ap-south-2 (Delhi, NCR), failover us-east
  Health checks: GET /health every 15s, 2 retries → drop pool on fail (circuit-breaker routing)
  Steering: Geo (NCR/India → Mumbai pool), latency-based fallback
```
**Edge-cacheable static asset offload** removes ~70–90% of static traffic from origin pods —
the largest single lever for backend pod count at scale.

## Redis — Sentinel (HA) alternative to Cluster
`redis-cluster.yaml` provides sharded cluster mode (cache + locks + pub-sub fan-out).
For smaller footprints, **Sentinel** gives HA without sharding:
```yaml
# 1 primary + 2 replicas + 3 sentinels (quorum 2) — automatic failover.
# bitnami/redis Helm:  architecture=replication, sentinel.enabled=true,
#   sentinel.quorum=2, replica.replicaCount=2, master.persistence.size=8Gi
# App reads the master via the sentinel service; failover is transparent (client
# already auto-reconnects — validated: Redis kill → API stayed 200, reconnect +2s).
```
**Layer roles (unchanged from current single Redis, just HA):** cache (TTL'd, `volatile-lru`),
distributed locks (`SET NX EX`), queue backing (BullMQ lists → KEDA workers), pub-sub WS fan-out,
presence.
