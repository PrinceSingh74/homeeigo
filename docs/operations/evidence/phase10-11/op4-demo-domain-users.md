# OP-4 (part 2) — users on a `.demo` domain

Generated 2026-09-24T04:32:48.820Z on `homigo_db`, read-only. 81 users. Nothing was reclassified.

**Evidence that applies to all of them:** `.demo` has no delegation in the public DNS root (`Resolve-DnsName homigo.demo` → "DNS name does not exist"), so no address here can receive mail. That is strong evidence of seeded/demo data, but it is not one of the rules the provenance policy defines (RFC 2606 reserved domains, suite plus-tags), so the owner must decide whether to adopt it.

| Domain | Users |
|---|---|
| homigo.demo | 81 |

| Role | Users | With provider row | With paid bookings | With active bookings |
|---|---|---|---|---|
| CUSTOMER | 74 | 0 | 72 | 3 |
| VENDOR | 4 | 4 | 0 | 0 |
| ADMIN | 3 | 0 | 0 | 0 |

## Recommended rule for the owner

Adopt "e-mail TLD not delegated in the DNS root ⇒ INFERRED_SYNTHETIC" as a provenance rule (structural, like RFC 2606 — not a name match), then run `provenance-report --apply`. Until then these users count as business. Accounts with **paid** bookings are flagged below: classifying them synthetic removes their bookings from revenue analytics, which is correct only if the payments were test-mode.

| User | Role | Created | Name | Provider | Bookings (total/completed/paid/active) | Last booking | Wallet rows | Proposed |
|---|---|---|---|---|---|---|---|---|
| `cmpqqqexc0003tzjw1bflho7l` | CUSTOMER | 2026-05-29 | Smoke | — | 4/0/0/1 | 2026-06-10 | 1 | INFERRED_SYNTHETIC |
| `cmq9h68mp0008tz8so7py2429` | CUSTOMER | 2026-06-11 | Arjun | — | 173/37/74/39 | 2026-09-06 | 8 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmqtyo4o1001utzdggvhonxvc` | CUSTOMER | 2026-06-25 | Priya | — | 1/0/0/1 | 2026-06-26 | 0 | INFERRED_SYNTHETIC |
| `cmt7dkcjd0000tzy8a4dgj14z` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7dmkyd0000tzkkia72b45c` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7dnmg70000tzzgs33mjdyf` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7dq1650000tzsk37p6cmz1` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7dug7a0000tz9s0ew8ey0n` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7duzgl0000tzs0kgtuexce` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7e2i0f0000tzsw2tmfz6xu` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7eagbk0000tz2knczr6hyv` | CUSTOMER | 2026-08-24 | Live | — | 1/1/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7ecd600000tzx4vkspywq4` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7eqghv0000tzj413zung16` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7i0ict0000tzmk8soj835b` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7i5sco0000tzcst5sxwiin` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7iaoad0000tz64weln1tyq` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7iuanb0000tzqoo9v3aw8i` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7j1r6p0000tz8g8wl4o38y` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7jggn00000tztc7n2ye1v0` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7jpbja0000tzkcojsnnhn6` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7js7uc0000tz5sqf8xe6sh` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7jy6lj0000tztohay80qus` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7k4stj0000tzh46h8ydm9m` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7kl5om0000tzewljwnn8tw` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7l0f9i0000tz2o2srj68nm` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7ldsc40000tzdgtdqmgifs` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7lle750000tzywuig781d5` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7lne2v0000tzxw40nver0l` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7lwyow0000tz9gj07osve1` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7m6eo20000tzgc2u7lipbb` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7mfofj0000tzccin13ucsa` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7mr0ad0000tz14sy4ozazq` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7mu5m40000tzd0sijbqxxp` | CUSTOMER | 2026-08-24 | Live | — | 1/0/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7n1li20000tz3wl6f6jeu0` | CUSTOMER | 2026-08-24 | Live | — | 1/1/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt7njfdm0000tzyk0n8fnbvg` | CUSTOMER | 2026-08-24 | Live | — | 1/1/1/0 | 2026-08-24 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt86yiyw0000tzxwsdsbog3t` | CUSTOMER | 2026-08-25 | Live | — | 1/1/1/0 | 2026-08-25 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmt87r1350000tzt8uez5ro90` | CUSTOMER | 2026-08-25 | Live | — | 1/1/1/0 | 2026-08-25 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtb4le260000tz60p334ndru` | CUSTOMER | 2026-08-27 | Live | — | 1/0/1/0 | 2026-08-27 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtb4vhdb0000tzogmrlh08x2` | CUSTOMER | 2026-08-27 | Live | — | 1/0/1/0 | 2026-08-27 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtb5rmvl0000tzr8zjhc7oxr` | CUSTOMER | 2026-08-27 | Live | — | 1/0/1/0 | 2026-08-27 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtb6m2sp0000tzbs2g2sew1q` | CUSTOMER | 2026-08-27 | Live | — | 1/0/1/0 | 2026-08-27 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtb6u7y50000tzg88pca6d91` | CUSTOMER | 2026-08-27 | Live | — | 1/0/1/0 | 2026-08-27 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtb7k46d0000tzqowwv6a9fz` | CUSTOMER | 2026-08-27 | Live | — | 1/0/1/0 | 2026-08-27 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtb83x7m0000tzast3f1vo3c` | CUSTOMER | 2026-08-27 | Live | — | 1/0/1/0 | 2026-08-27 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtb8hp2u0000tz90vz3xnag6` | CUSTOMER | 2026-08-27 | Live | — | 1/0/1/0 | 2026-08-27 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtb8rndo0000tzywoiny7jqt` | CUSTOMER | 2026-08-27 | Live | — | 1/0/1/0 | 2026-08-27 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtb93h4s0000tz8ort9brkkz` | CUSTOMER | 2026-08-27 | Live | — | 1/0/1/0 | 2026-08-27 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtbgu8gs0000tz3g65qbyajp` | CUSTOMER | 2026-08-27 | Live | — | 1/0/1/0 | 2026-08-27 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtbhd15d0000tzq4o993w4vd` | CUSTOMER | 2026-08-27 | Live | — | 1/0/1/0 | 2026-08-27 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtdw8x2k0000tzs877js6nvi` | CUSTOMER | 2026-08-29 | Live | — | 1/0/1/0 | 2026-08-29 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmte06hmi0000tzxogi5io0g9` | CUSTOMER | 2026-08-29 | Live | — | 1/0/1/0 | 2026-08-29 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmte0m06q0000tz34w1o2b9il` | CUSTOMER | 2026-08-29 | Live | — | 1/1/1/0 | 2026-08-29 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmte1gca40000tzlk0fh7w86z` | CUSTOMER | 2026-08-29 | Live | — | 1/1/1/0 | 2026-08-29 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmte9nssf0000tzvgb1m4wn9i` | CUSTOMER | 2026-08-29 | Live | — | 1/1/1/0 | 2026-08-29 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtiuoujv0000tz6w1itw05z2` | CUSTOMER | 2026-09-01 | Live | — | 1/0/1/0 | 2026-09-01 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtiwy9xu0000tzy881tdw110` | CUSTOMER | 2026-09-01 | Live | — | 1/1/1/0 | 2026-09-01 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtkdrspr0000tznwo0x7ipmz` | CUSTOMER | 2026-09-02 | Live | — | 1/0/1/0 | 2026-09-02 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtkek2ph0000tz287gm6dn9t` | CUSTOMER | 2026-09-02 | Live | — | 1/1/1/0 | 2026-09-02 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtkfip5f0000tzcgfxhi991r` | CUSTOMER | 2026-09-02 | Live | — | 1/1/1/0 | 2026-09-02 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtkfwejf0000tzk8kvjny9gf` | CUSTOMER | 2026-09-02 | Live | — | 1/1/1/0 | 2026-09-02 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtl77szs0000tzgklr9r54ue` | CUSTOMER | 2026-09-03 | Live | — | 1/1/1/0 | 2026-09-03 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtl8umjo0000tzesthjsxncw` | CUSTOMER | 2026-09-03 | Live | — | 1/1/1/0 | 2026-09-03 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtlpjo890000tzbon3s8xx6l` | CUSTOMER | 2026-09-03 | Live | — | 1/1/1/0 | 2026-09-03 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtlza9q10000tz4wcpx1y1dm` | CUSTOMER | 2026-09-03 | Live | — | 1/1/1/0 | 2026-09-03 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtmwhsre0000tz08rs75s61x` | CUSTOMER | 2026-09-04 | Live | — | 1/1/1/0 | 2026-09-04 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtmxy88n0000tz109xng83yk` | CUSTOMER | 2026-09-04 | Live | — | 1/0/1/0 | 2026-09-04 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtmz4ibw0000tz5kx7ls44z6` | CUSTOMER | 2026-09-04 | Live | — | 1/1/1/0 | 2026-09-04 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtn0ou1e0000tz2g72ipa928` | CUSTOMER | 2026-09-04 | Live | — | 1/1/1/0 | 2026-09-04 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtn1m00y0000tzw8ifvtho05` | CUSTOMER | 2026-09-04 | Live | — | 1/1/1/0 | 2026-09-04 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtneczw10000tz6cqedkl5os` | CUSTOMER | 2026-09-04 | Live | — | 1/1/1/0 | 2026-09-04 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmtnfjlr70000tzq49uga3zc5` | CUSTOMER | 2026-09-04 | Live | — | 1/0/1/0 | 2026-09-04 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmto19zs30000tzj89k9yztv8` | CUSTOMER | 2026-09-05 | Live | — | 1/1/1/0 | 2026-09-05 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmto3enqq0000tzoc2jilf2ll` | CUSTOMER | 2026-09-05 | Live | — | 1/1/1/0 | 2026-09-05 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmto46e2s0000tzh4ntiszn64` | CUSTOMER | 2026-09-05 | Live | — | 1/1/1/0 | 2026-09-05 | 0 | INFERRED_SYNTHETIC — **owner confirm (paid bookings)** |
| `cmpqqqexi0004tzjwh20sheeb` | VENDOR | 2026-05-29 | Rahul | `cmq6b0iue0001tzbo5fnp9t5q` ACTIVE | 0/0/0/0 | — | 0 | INFERRED_SYNTHETIC |
| `cmq9h68780003tz8sc6scw3kj` | VENDOR | 2026-06-11 | Rahul | `cmq9h687s0005tz8swhtkju1p` ACTIVE | 0/0/0/0 | — | 0 | INFERRED_SYNTHETIC |
| `cmsitqx7z0000tzbcqrkf5t83` | VENDOR | 2026-08-07 | Vendor | `cmsitqxy40002tzbczjyo2ex8` ACTIVE | 0/0/0/0 | — | 0 | INFERRED_SYNTHETIC |
| `cmticp4uk0001tzw09yx4m827` | VENDOR | 2026-09-01 | Priya | `cmticp4vl0004tzw0ovm2g2es` ACTIVE | 0/0/0/0 | — | 0 | INFERRED_SYNTHETIC |
| `cmpqqqexo0005tzjwsp6ldm9p` | ADMIN | 2026-05-29 | Homigo | — | 0/0/0/0 | — | 0 | INFERRED_SYNTHETIC |
| `cmq9h67pk0000tz8s6tvnpet5` | ADMIN | 2026-06-11 | Homigo | — | 0/0/0/0 | — | 0 | INFERRED_SYNTHETIC |
| `cmqb61b030000tzgcqb6wv062` | ADMIN | 2026-06-12 | Finance | — | 0/0/0/0 | — | 0 | INFERRED_SYNTHETIC |
