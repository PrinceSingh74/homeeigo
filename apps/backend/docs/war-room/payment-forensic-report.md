# Payment Forensic Report

Generated: 2026-06-17T09:34:41.265Z

## Scope
SUCCESS payments traced end-to-end (latest 500).

## Summary
| Metric | Count |
|--------|------:|
| SUCCESS payments sampled | 63 |
| Payments with lifecycle gaps | 63 |
| Missing Razorpay order | 0 |
| Missing Razorpay payment ID | 0 |
| Missing settlement link | 63 |
| Missing journal | 0 |
| Missing ledger | 0 |
| Missing provider payable journal | 45 |

## SQL Evidence — Unsettled SUCCESS payments (>3 days)
```sql
SELECT id, booking_id, amount_paid, razorpay_payment_id, settlement_id, completed_at, created_at
FROM payments
WHERE status = 'SUCCESS' AND settlement_id IS NULL
  AND completed_at < now() - interval '3 days';
```

```json
[
  {
    "id": "cmq6ukeku000ntzocifrzi9mx",
    "booking_id": "cmq6ukek3000ltzocwbt1bwvu",
    "amount_paid": 500,
    "razorpay_payment_id": "pay_adv_adv-audit-mq6uke74",
    "settlement_id": null,
    "completed_at": "2026-06-09T16:21:28.397Z",
    "created_at": "2026-06-09T16:21:28.398Z"
  },
  {
    "id": "cmq928i2p038jtzcc6wse0msy",
    "booking_id": "cmq928hii0384tzccrjfq4i7q",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_T0D5YQv5W9YBM2",
    "settlement_id": null,
    "completed_at": "2026-06-11T05:33:42.045Z",
    "created_at": "2026-06-11T05:31:42.337Z"
  },
  {
    "id": "cmq93gyh8005wtz9clefn75l9",
    "booking_id": "cmq93gxjr005htz9c1hso267r",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_T0DeQ1f527aXu5",
    "settlement_id": null,
    "completed_at": "2026-06-11T06:06:42.189Z",
    "created_at": "2026-06-11T06:06:16.461Z"
  },
  {
    "id": "cmq946cae011ptzn8i0rku85o",
    "booking_id": "cmq946bmo0119tzn8mc0ejtms",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_T0DzHYHgPjyHQq",
    "settlement_id": null,
    "completed_at": "2026-06-11T06:26:27.914Z",
    "created_at": "2026-06-11T06:26:00.758Z"
  },
  {
    "id": "cmq94i67r00xdtz8kxj96nfld",
    "booking_id": "cmq94i5i400wxtz8kpi5dv9yb",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_T0E8zTnQemiDB8",
    "settlement_id": null,
    "completed_at": "2026-06-11T06:35:42.485Z",
    "created_at": "2026-06-11T06:35:12.759Z"
  },
  {
    "id": "cmq94q491008ztzswrxbd7h9g",
    "booking_id": "cmq94q318008ktzsw1trasfzv",
    "amount_paid": 989,
    "razorpay_payment_id": "pay_T0EFTvuFCg1sSN",
    "settlement_id": null,
    "completed_at": "2026-06-11T06:41:47.837Z",
    "created_at": "2026-06-11T06:41:23.461Z"
  },
  {
    "id": "cmq95rzr401gqtzswgzq1o1tj",
    "booking_id": "cmq95ryd901gbtzsw22vxdd5r",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_T0EkdXpsYQXXNS",
    "settlement_id": null,
    "completed_at": "2026-06-11T07:11:18.150Z",
    "created_at": "2026-06-11T07:10:50.559Z"
  },
  {
    "id": "cmq969eek025ltzswnieg30d9",
    "booking_id": "cmq969d8g0256tzswzifjw5p3",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_T0Eyy8Xbrqgmwo",
    "settlement_id": null,
    "completed_at": "2026-06-11T07:24:51.212Z",
    "created_at": "2026-06-11T07:24:22.700Z"
  },
  {
    "id": "cmq96c8dx028htzswtv8x9c0f",
    "booking_id": "cmq96c7fc0282tzsw00s2mmve",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_T0F1CPzS3RwtMr",
    "settlement_id": null,
    "completed_at": "2026-06-11T07:26:57.141Z",
    "created_at": "2026-06-11T07:26:34.868Z"
  },
  {
    "id": "cmq96faui02bxtzswql0p654t",
    "booking_id": "cmq96f9tm02bitzswvr0ucu1d",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_T0F3nos7mnMz83",
    "settlement_id": null,
    "completed_at": "2026-06-11T07:31:36.134Z",
    "created_at": "2026-06-11T07:28:58.026Z"
  },
  {
    "id": "cmq9778ry03eptzsw8w3uz0j1",
    "booking_id": "cmq9777rr03eatzsw3jz8d3yk",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_T0FQidyIULqNUd",
    "settlement_id": null,
    "completed_at": "2026-06-11T07:51:35.945Z",
    "created_at": "2026-06-11T07:50:41.710Z"
  },
  {
    "id": "cmq97blfm03kptzswwos5uksk",
    "booking_id": "cmq97bjxn03katzswnyc7zk20",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_T0FUG7BOqFR9wW",
    "settlement_id": null,
    "completed_at": "2026-06-11T07:54:30.523Z",
    "created_at": "2026-06-11T07:54:04.737Z"
  },
  {
    "id": "cmqaib51v004ctzfcfm78eayk",
    "booking_id": "cmqaib4bd003xtzfcumvoxxnt",
    "amount_paid": 439,
    "razorpay_payment_id": "pay_T0btnNUSFU6C3l",
    "settlement_id": null,
    "completed_at": "2026-06-12T05:49:54.857Z",
    "created_at": "2026-06-12T05:49:25.459Z"
  },
  {
    "id": "cmqbzrpm900aktzs88215d0yw",
    "booking_id": "cmqbzrnuk009utzs82la45npf",
    "amount_paid": 494,
    "razorpay_payment_id": "pay_T11OcqEMv5YiyO",
    "settlement_id": null,
    "completed_at": "2026-06-13T06:46:26.780Z",
    "created_at": "2026-06-13T06:45:58.256Z"
  },
  {
    "id": "cmqair89w075ftzfc9ow1x3vd",
    "booking_id": "cmqair7rk0750tzfcfy7r58a3",
    "amount_paid": 439,
    "razorpay_payment_id": "pay_T0c6yZn2RtczJo",
    "settlement_id": null,
    "completed_at": "2026-06-12T06:02:21.435Z",
    "created_at": "2026-06-12T06:01:56.132Z"
  },
  {
    "id": "cmqaqnxcj00a8tzt0qrjx0yfi",
    "booking_id": "cmqaqnvek009htzt01ldmdgmc",
    "amount_paid": 494,
    "razorpay_payment_id": "pay_T0fsrMw1OlgR7H",
    "settlement_id": null,
    "completed_at": "2026-06-12T09:43:50.883Z",
    "created_at": "2026-06-12T09:43:18.930Z"
  },
  {
    "id": "cmqav2cqq03pttzmww8inzr3i",
    "booking_id": "cmqav2bha03oytzmwi8f1dn4x",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqav2cza",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:46:31.111Z",
    "created_at": "2026-06-12T11:46:30.530Z"
  },
  {
    "id": "cmqaqryri00rbtzt050tj00e7",
    "booking_id": "cmqaqrxcq00qktzt0l5jorz0r",
    "amount_paid": 494,
    "razorpay_payment_id": "pay_T0fw4JxLya0Jqs",
    "settlement_id": null,
    "completed_at": "2026-06-12T09:46:50.858Z",
    "created_at": "2026-06-12T09:46:27.390Z"
  },
  {
    "id": "cmqak7sei09cdtzqw015ptnv2",
    "booking_id": "cmqak7rqc09bttzqw2s9iijq8",
    "amount_paid": 494,
    "razorpay_payment_id": "pay_T0co4mJ5XJIu3R",
    "settlement_id": null,
    "completed_at": "2026-06-12T06:43:09.765Z",
    "created_at": "2026-06-12T06:42:48.330Z"
  },
  {
    "id": "cmqaksg1u00k8tzhs377q0080",
    "booking_id": "cmqakscws00jktzhs0avko5cr",
    "amount_paid": 494,
    "razorpay_payment_id": "pay_T0d53W8I16sG78",
    "settlement_id": null,
    "completed_at": "2026-06-12T06:59:14.984Z",
    "created_at": "2026-06-12T06:58:52.095Z"
  },
  {
    "id": "cmqaku3ud00pytzhsce38dl8g",
    "booking_id": "cmqaku2zn00pbtzhsfoj8ag7c",
    "amount_paid": 494,
    "razorpay_payment_id": "pay_T0d6VR1cEGFw5l",
    "settlement_id": null,
    "completed_at": "2026-06-12T07:00:36.607Z",
    "created_at": "2026-06-12T07:00:09.589Z"
  },
  {
    "id": "cmqakxfx700wqtzhsraacst3n",
    "booking_id": "cmqakxesz00w3tzhslew8ep0z",
    "amount_paid": 494,
    "razorpay_payment_id": "pay_T0d9C33J8GHt6z",
    "settlement_id": null,
    "completed_at": "2026-06-12T07:03:10.431Z",
    "created_at": "2026-06-12T07:02:45.211Z"
  },
  {
    "id": "cmqal8upw0073tzq0lp3ks0d4",
    "booking_id": "cmqal8tpb006ftzq0chchog4p",
    "amount_paid": 494,
    "razorpay_payment_id": "pay_T0dIbWjdbRHTes",
    "settlement_id": null,
    "completed_at": "2026-06-12T07:12:04.059Z",
    "created_at": "2026-06-12T07:11:37.603Z"
  },
  {
    "id": "cmqale4hf00lotzq0pmj5ot74",
    "booking_id": "cmqale3kv00l2tzq044bmo9dz",
    "amount_paid": 494,
    "razorpay_payment_id": "pay_T0dMtehiX7lfNA",
    "settlement_id": null,
    "completed_at": "2026-06-12T07:16:07.769Z",
    "created_at": "2026-06-12T07:15:43.539Z"
  },
  {
    "id": "cmqak3dlw092utzqwwvp9we5c",
    "booking_id": "cmqak3cuk0927tzqwdeq2dzlr",
    "amount_paid": 439,
    "razorpay_payment_id": "pay_T0ckoHr3o06iIz",
    "settlement_id": null,
    "completed_at": "2026-06-12T06:40:04.837Z",
    "created_at": "2026-06-12T06:39:22.532Z"
  },
  {
    "id": "cmqajxqh207lgtzqwdrb63z0q",
    "booking_id": "cmqajxq0007l0tzqwi8jklii9",
    "amount_paid": 494,
    "razorpay_payment_id": "pay_T0cfrTKCOuDIbn",
    "settlement_id": null,
    "completed_at": "2026-06-12T06:35:24.073Z",
    "created_at": "2026-06-12T06:34:59.270Z"
  },
  {
    "id": "cmqatosig00t9tzq8y110v1l8",
    "booking_id": "cmqatoru900sctzq8tvlmrnsf",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqatosnz",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:07:58.671Z",
    "created_at": "2026-06-12T11:07:58.168Z"
  },
  {
    "id": "cmqatigc902aatzvo6gouop05",
    "booking_id": "cmqatifpk029dtzvou5426iih",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqatigjd",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:03:03.210Z",
    "created_at": "2026-06-12T11:03:02.457Z"
  },
  {
    "id": "cmqat6olw0064tzvodyzln2t0",
    "booking_id": "cmqat6nzd0055tzvolu9j0rws",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqat6ovp",
    "settlement_id": null,
    "completed_at": "2026-06-12T10:53:53.915Z",
    "created_at": "2026-06-12T10:53:53.300Z"
  },
  {
    "id": "cmqat9dfr00s9tzvo94ifm8ro",
    "booking_id": "cmqat9crr00ratzvovzpns8m6",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqat9dkm",
    "settlement_id": null,
    "completed_at": "2026-06-12T10:55:59.220Z",
    "created_at": "2026-06-12T10:55:58.791Z"
  },
  {
    "id": "cmqatsj9q0140tzq8hovpbhhm",
    "booking_id": "cmqats3hn0136tzq8x36v43kr",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_diag2",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:10:53.258Z",
    "created_at": "2026-06-12T11:10:52.814Z"
  },
  {
    "id": "cmqata7od00yrtzvokckk2u5w",
    "booking_id": "cmqata77f00xutzvom161ecsb",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqata7sk",
    "settlement_id": null,
    "completed_at": "2026-06-12T10:56:38.339Z",
    "created_at": "2026-06-12T10:56:37.981Z"
  },
  {
    "id": "cmqatart5014ztzvofqhodzo3",
    "booking_id": "cmqatarbl0140tzvoygustfw4",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqatarxm",
    "settlement_id": null,
    "completed_at": "2026-06-12T10:57:04.441Z",
    "created_at": "2026-06-12T10:57:04.073Z"
  },
  {
    "id": "cmqattyxm019ytzq845ejx6ok",
    "booking_id": "cmqattygg0191tzq88i6i55ta",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqatu0e2",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:12:01.900Z",
    "created_at": "2026-06-12T11:11:59.770Z"
  },
  {
    "id": "cmqatufgq01hotzq8jaiwj89n",
    "booking_id": "cmqatuewf01grtzq8c81wr6cj",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqatufnp",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:12:21.740Z",
    "created_at": "2026-06-12T11:12:21.194Z"
  },
  {
    "id": "cmqatutos01ontzq8vadgkjsg",
    "booking_id": "cmqatut5d01notzq8y6eunfek",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqatutv2",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:12:40.176Z",
    "created_at": "2026-06-12T11:12:39.628Z"
  },
  {
    "id": "cmqatb4ys01cbtzvoa79qbgqs",
    "booking_id": "cmqatb4dq01betzvo5ivn47rs",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqatb53p",
    "settlement_id": null,
    "completed_at": "2026-06-12T10:57:21.531Z",
    "created_at": "2026-06-12T10:57:21.124Z"
  },
  {
    "id": "cmqatgond01tttzvok0vefl6d",
    "booking_id": "cmqatgm9f01sxtzvoi641yzyw",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqatgpas",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:01:42.711Z",
    "created_at": "2026-06-12T11:01:39.908Z"
  },
  {
    "id": "cmqathpws0221tzvov9rhl97m",
    "booking_id": "cmqathp2c0215tzvojdv5vfiu",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqathq4k",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:02:28.909Z",
    "created_at": "2026-06-12T11:02:28.204Z"
  },
  {
    "id": "cmqatj78w02httzvomoo15obr",
    "booking_id": "cmqatj6jy02gxtzvoddedhtjn",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqatj7ep",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:03:37.988Z",
    "created_at": "2026-06-12T11:03:37.328Z"
  },
  {
    "id": "cmqatna3r00motzq8i6cdzw37",
    "booking_id": "cmqatn95j00lstzq8n0zozqsh",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqatnabc",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:06:48.366Z",
    "created_at": "2026-06-12T11:06:47.656Z"
  },
  {
    "id": "cmqaudt4900omtzmwlyad0bkd",
    "booking_id": "cmqaudsif00nptzmw83a7gmur",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqaudtca",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:27:25.962Z",
    "created_at": "2026-06-12T11:27:25.353Z"
  },
  {
    "id": "cmqaujr1a01fztzmwe087j4uq",
    "booking_id": "cmqaujqg301f4tzmwfgs0i4ix",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqaujrar",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:32:03.224Z",
    "created_at": "2026-06-12T11:32:02.590Z"
  },
  {
    "id": "cmqatwn3q01wgtzq8pbf2azqh",
    "booking_id": "cmqatwmdq01vjtzq87cu49t24",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqatwnbe",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:14:05.033Z",
    "created_at": "2026-06-12T11:14:04.406Z"
  },
  {
    "id": "cmqatyokq02jltzq8pe5u6v8q",
    "booking_id": "cmqatyo0f02iotzq8xmu6ujin",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqatyou3",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:15:40.256Z",
    "created_at": "2026-06-12T11:15:39.626Z"
  },
  {
    "id": "cmqaup1cf027ztzmw0d81wk2d",
    "booking_id": "cmqaup0qy0271tzmwyfc7om10",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqaup1hg",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:36:09.668Z",
    "created_at": "2026-06-12T11:36:09.231Z"
  },
  {
    "id": "cmqauw7q6030ltzmwdtjn6jp2",
    "booking_id": "cmqauw6ot02zqtzmwepfwsfyb",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqauw82g",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:41:44.933Z",
    "created_at": "2026-06-12T11:41:44.095Z"
  },
  {
    "id": "cmqau27x1035vtzq8rirva7pe",
    "booking_id": "cmqau27f7034ytzq8al740rcr",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqau285s",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:18:25.256Z",
    "created_at": "2026-06-12T11:18:24.661Z"
  },
  {
    "id": "cmqau9t4y045ktzq85awwpz5c",
    "booking_id": "cmqau9sg4044qtzq8ed1097my",
    "amount_paid": 550,
    "razorpay_payment_id": "pay_e2e_mqau9tg4",
    "settlement_id": null,
    "completed_at": "2026-06-12T11:24:19.555Z",
    "created_at": "2026-06-12T11:24:18.754Z"
  }
]
```

## SQL Evidence — SUCCESS with null completed_at (invisible to settlement check)
```sql
SELECT count(*) FROM payments WHERE status = 'SUCCESS' AND settlement_id IS NULL AND completed_at IS NULL;
```
Result: **0**

## Sample gap records (first 25)
| Payment ID | Booking | Amount | Gaps |
|------------|---------|-------:|------|
| cmqhofxj… | cmqhofvw… | ₹439 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqho9pk… | cmqho9ny… | ₹494 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqho5c6… | cmqho57e… | ₹550 | MISSING_SETTLEMENT |
| cmqgfatk… | cmqgfasf… | ₹660 | MISSING_SETTLEMENT |
| cmqgf2zb… | cmqgf2y2… | ₹494 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqgeowd… | cmqgeouz… | ₹494 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqfkd07… | cmqfkcxg… | ₹550 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqficb0… | cmqfic8k… | ₹494 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqfi5nr… | cmqfi5lw… | ₹494 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqfi1vg… | cmqfi1tm… | ₹439 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqfhyov… | cmqfhyms… | ₹494 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqfhwca… | cmqfhw9z… | ₹989 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqf6189… | cmqf6166… | ₹494 | MISSING_SETTLEMENT |
| cmqf5wqn… | cmqf5woi… | ₹439 | MISSING_SETTLEMENT |
| cmqbzrpm… | cmqbzrnu… | ₹494 | MISSING_SETTLEMENT |
| cmqav2cq… | cmqav2bh… | ₹550 | MISSING_SETTLEMENT |
| cmqauw7q… | cmqauw6o… | ₹550 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqaup1c… | cmqaup0q… | ₹550 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqaujr1… | cmqaujqg… | ₹550 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqaudt4… | cmqaudsi… | ₹550 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqau9t4… | cmqau9sg… | ₹550 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqau27x… | cmqau27f… | ₹550 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqatyok… | cmqatyo0… | ₹550 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqatwn3… | cmqatwmd… | ₹550 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
| cmqatuto… | cmqatut5… | ₹550 | MISSING_SETTLEMENT, MISSING_PROVIDER_PAYABLE_JOURNAL |
