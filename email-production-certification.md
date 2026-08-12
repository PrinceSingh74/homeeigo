# Email Production Certification

**Generated:** 2026-07-03T11:05:44.318Z

## Provider

| Check | Result |
|-------|--------|
| RESEND_API_KEY | **NOT SET** |
| EMAIL_FROM | HOMIGO <noreply@homigo.com> |
| Resend API reachable | N/A (no key) |
| Delivery probe | NOT RUN (set CERTIFICATION_EMAIL_TO) |

## DNS (runtime nslookup)

**Domain:** homigo.com

### SPF (@)
```
homigo.com	text =
"v=spf1 mx include:spf.autopilothq.com include:sendgrid.net include:_spf.google.com include:spf.mtasv.net ~all"
```

### DMARC (_dmarc)
```

```

### DKIM (resend._domainkey)
```

```


## Wired Email Types (v8)

| Type | Status |
|------|--------|
| Invoice PDF attach | WIRED (payment.service → invoice.service.generatePdf) |
| Fraud alert (HIGH/CRITICAL) | WIRED (referral-fraud.service → ADMIN_EMAIL) |
| Recovery alert | WIRED (payment reconcilePendingOrders) |

## Resend Domains API

```json
null
```
