[ddl-guard] classify-accepted-unpaid-bookings (READ ONLY) → homigo_db (postgresql://postgres:***@localhost:5433/homigo_db)
O9 — ACCEPTED-but-unpaid booking classification (READ ONLY, no rows were modified)
database: homigo_db
generated: 2026-09-23T05:50:35.784Z
owner decision 2026-09-23: NO retroactive 15-minute TTL. These rows are legacy operational state.

total ACCEPTED + unsettled payment: 44

| class | bookings | value (INR) |
|---|---|---|
| LEGACY_UNPAID | 41 | 23379 |
| PAYMENT_NOT_FOUND | 2 | 1266 |
| PAYMENT_INDETERMINATE | 1 | 550 |

## LEGACY_UNPAID (41)
  HOMIGO-20260609-00054  id=cmq6v39pa031dtztct08v9a9q  scheduled=2026-06-24T06:00:00.000Z  amount=550  provider=cmq6v2wks00lftztc8kfu0o9r  order=none  gatewayPayment=none
      → appointment 2026-06-24T06:00:00.000Z already passed, unpaid
  HOMIGO-20260612-00027  id=cmqashs1p0013tz18jnjzg6ut  scheduled=2026-06-23T16:30:00.000Z  amount=550  provider=cmqashrdh000btz18m3sqnl1a  order=none  gatewayPayment=none
      → appointment 2026-06-23T16:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00028  id=cmqashs860015tz187c1e5hrj  scheduled=2026-06-23T18:30:00.000Z  amount=550  provider=cmqashrdh000btz18m3sqnl1a  order=none  gatewayPayment=none
      → appointment 2026-06-23T18:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00029  id=cmqashsbd0017tz18412w5k3s  scheduled=2026-06-23T20:30:00.000Z  amount=550  provider=cmqashrdh000btz18m3sqnl1a  order=none  gatewayPayment=none
      → appointment 2026-06-23T20:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00030  id=cmqashsfv0019tz1894syod61  scheduled=2026-06-23T02:30:00.000Z  amount=550  provider=cmqashrdh000btz18m3sqnl1a  order=none  gatewayPayment=none
      → appointment 2026-06-23T02:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00031  id=cmqashskf001btz18jpctghks  scheduled=2026-06-23T04:30:00.000Z  amount=550  provider=cmqashrdh000btz18m3sqnl1a  order=none  gatewayPayment=none
      → appointment 2026-06-23T04:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00032  id=cmqashsor001dtz185nqu8xze  scheduled=2026-06-24T02:30:00.000Z  amount=550  provider=cmqashrdh000btz18m3sqnl1a  order=none  gatewayPayment=none
      → appointment 2026-06-24T02:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00033  id=cmqashsss001ftz18viaa4jby  scheduled=2026-06-19T04:30:00.000Z  amount=550  provider=cmqashrdh000btz18m3sqnl1a  order=none  gatewayPayment=none
      → appointment 2026-06-19T04:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00034  id=cmqashsvv001htz18dnmkjpce  scheduled=2026-06-24T06:30:00.000Z  amount=550  provider=cmqashrdh000btz18m3sqnl1a  order=none  gatewayPayment=none
      → appointment 2026-06-24T06:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00035  id=cmqashsyh001jtz18dhpser2v  scheduled=2026-06-22T16:30:00.000Z  amount=550  provider=cmqashrdh000btz18m3sqnl1a  order=none  gatewayPayment=none
      → appointment 2026-06-22T16:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00036  id=cmqasht1r001ltz18gubgo18o  scheduled=2026-06-23T14:30:00.000Z  amount=550  provider=cmqashrdh000btz18m3sqnl1a  order=none  gatewayPayment=none
      → appointment 2026-06-23T14:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00037  id=cmqasimo10013tz18e0suyblt  scheduled=2026-06-18T02:30:00.000Z  amount=550  provider=cmqasim8o000btz18aocof48s  order=none  gatewayPayment=none
      → appointment 2026-06-18T02:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00038  id=cmqasimrq0015tz18pl3odxgk  scheduled=2026-06-18T23:30:00.000Z  amount=550  provider=cmqasim8o000btz18aocof48s  order=none  gatewayPayment=none
      → appointment 2026-06-18T23:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00039  id=cmqasimut0017tz18sqj3ytrw  scheduled=2026-06-18T04:30:00.000Z  amount=550  provider=cmqasim8o000btz18aocof48s  order=none  gatewayPayment=none
      → appointment 2026-06-18T04:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00040  id=cmqasimyc0019tz18ldxa91nl  scheduled=2026-06-17T09:30:00.000Z  amount=550  provider=cmqasim8o000btz18aocof48s  order=none  gatewayPayment=none
      → appointment 2026-06-17T09:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00041  id=cmqasin2p001btz18kovb615s  scheduled=2026-06-16T14:30:00.000Z  amount=550  provider=cmqasim8o000btz18aocof48s  order=none  gatewayPayment=none
      → appointment 2026-06-16T14:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00042  id=cmqasin5x001dtz18t4sxm1k7  scheduled=2026-06-17T01:30:00.000Z  amount=550  provider=cmqasim8o000btz18aocof48s  order=none  gatewayPayment=none
      → appointment 2026-06-17T01:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00043  id=cmqasin8m001ftz1841gnhh1b  scheduled=2026-06-17T12:30:00.000Z  amount=550  provider=cmqasim8o000btz18aocof48s  order=none  gatewayPayment=none
      → appointment 2026-06-17T12:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00044  id=cmqasinbd001htz18uj1bnry0  scheduled=2026-06-16T17:30:00.000Z  amount=550  provider=cmqasim8o000btz18aocof48s  order=none  gatewayPayment=none
      → appointment 2026-06-16T17:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00045  id=cmqasine2001jtz18eobtfttr  scheduled=2026-06-18T10:30:00.000Z  amount=550  provider=cmqasim8o000btz18aocof48s  order=none  gatewayPayment=none
      → appointment 2026-06-18T10:30:00.000Z already passed, unpaid
  HOMIGO-20260612-00046  id=cmqasingf001ltz18r9a5qxq4  scheduled=2026-06-18T21:30:00.000Z  amount=550  provider=cmqasim8o000btz18aocof48s  order=none  gatewayPayment=none
      → appointment 2026-06-18T21:30:00.000Z already passed, unpaid
  HOMIGO-20260614-00001  id=cmqe4oznt000etzykeqtv3n88  scheduled=2026-06-17T18:39:21.654Z  amount=550  provider=cmqe4ozjd0004tzyko1goebs6  order=none  gatewayPayment=none
      → appointment 2026-06-17T18:39:21.654Z already passed, unpaid
  HOMIGO-20260614-00003  id=cmqe4pidw000etzy0wuissxt4  scheduled=2026-06-17T18:39:45.940Z  amount=550  provider=cmqe4piav0004tzy0s93jfdq2  order=none  gatewayPayment=none
      → appointment 2026-06-17T18:39:45.940Z already passed, unpaid
  RC-1781462414608-0  id=cmqe4q4gh000etzf003x9y8kq  scheduled=2026-06-17T18:40:14.608Z  amount=500  provider=cmqe4q4do0004tzf07oyl506k  order=none  gatewayPayment=none
      → appointment 2026-06-17T18:40:14.608Z already passed, unpaid
  RC-1781462414625-1  id=cmqe4q4gx000itzf0fblr9ym4  scheduled=2026-06-18T18:40:14.625Z  amount=500  provider=cmqe4q4do0004tzf07oyl506k  order=none  gatewayPayment=none
      → appointment 2026-06-18T18:40:14.625Z already passed, unpaid
  RC-1781462414633-2  id=cmqe4q4h6000mtzf0vrc3hni7  scheduled=2026-06-19T18:40:14.633Z  amount=500  provider=cmqe4q4do0004tzf07oyl506k  order=none  gatewayPayment=none
      → appointment 2026-06-19T18:40:14.633Z already passed, unpaid
  FM-1781465087614-0  id=cmqe6beyo000etz6c5r7gstae  scheduled=2026-06-17T19:24:47.614Z  amount=500  provider=cmqe6bews0004tz6ce9vzp6uz  order=none  gatewayPayment=none
      → appointment 2026-06-17T19:24:47.614Z already passed, unpaid
  FM-1781465087636-1  id=cmqe6beza000itz6cykrq5o2m  scheduled=2026-06-18T19:24:47.636Z  amount=500  provider=cmqe6bews0004tz6ce9vzp6uz  order=none  gatewayPayment=none
      → appointment 2026-06-18T19:24:47.636Z already passed, unpaid
  HOMIGO-20260905-00058  id=cmtonpaxt02bztz38kyptkezc  scheduled=2026-09-22T09:00:00.000Z  amount=633  provider=cmtonpajt027jtz38iyc8ifbq  order=none  gatewayPayment=none
      → appointment 2026-09-22T09:00:00.000Z already passed, unpaid
  HOMIGO-20260905-00112  id=cmtonpi7703tgtz38ycvcmwcj  scheduled=2026-09-17T01:00:00.000Z  amount=633  provider=cmtonpi3x03sntz38n699jwyu  order=none  gatewayPayment=none
      → appointment 2026-09-17T01:00:00.000Z already passed, unpaid
  HOMIGO-20260905-00113  id=cmtonpjs003z5tz38nlp23w98  scheduled=2026-09-10T05:00:00.000Z  amount=633  provider=cmtonpi3x03sntz38n699jwyu  order=none  gatewayPayment=none
      → appointment 2026-09-10T05:00:00.000Z already passed, unpaid
  HOMIGO-20260905-00114  id=cmtonpjxa03zatz38b9x2e7v9  scheduled=2026-09-10T21:00:00.000Z  amount=633  provider=cmtonpi3x03sntz38n699jwyu  order=none  gatewayPayment=none
      → appointment 2026-09-10T21:00:00.000Z already passed, unpaid
  HOMIGO-20260905-00115  id=cmtonpk0s03zftz38cqy0bxi6  scheduled=2026-09-11T19:00:00.000Z  amount=633  provider=cmtonpi3x03sntz38n699jwyu  order=none  gatewayPayment=none
      → appointment 2026-09-11T19:00:00.000Z already passed, unpaid
  HOMIGO-20260905-00116  id=cmtonpk4q03zktz384j6emk0n  scheduled=2026-09-12T19:00:00.000Z  amount=633  provider=cmtonpi3x03sntz38n699jwyu  order=none  gatewayPayment=none
      → appointment 2026-09-12T19:00:00.000Z already passed, unpaid
  HOMIGO-20260905-00117  id=cmtonpkai03zptz38zr4sn3ls  scheduled=2026-09-13T09:00:00.000Z  amount=633  provider=cmtonpi3x03sntz38n699jwyu  order=none  gatewayPayment=none
      → appointment 2026-09-13T09:00:00.000Z already passed, unpaid
  HOMIGO-20260905-00118  id=cmtonpke603zutz38qya8le0h  scheduled=2026-09-14T17:00:00.000Z  amount=633  provider=cmtonpi3x03sntz38n699jwyu  order=none  gatewayPayment=none
      → appointment 2026-09-14T17:00:00.000Z already passed, unpaid
  HOMIGO-20260905-00119  id=cmtonpkhr03zztz3872barn3y  scheduled=2026-09-15T15:00:00.000Z  amount=633  provider=cmtonpi3x03sntz38n699jwyu  order=none  gatewayPayment=none
      → appointment 2026-09-15T15:00:00.000Z already passed, unpaid
  HOMIGO-20260905-00120  id=cmtonpkl80404tz38cinh22px  scheduled=2026-09-16T09:00:00.000Z  amount=633  provider=cmtonpi3x03sntz38n699jwyu  order=none  gatewayPayment=none
      → appointment 2026-09-16T09:00:00.000Z already passed, unpaid
  HOMIGO-20260905-00121  id=cmtonpkpc0409tz384rpbr5qg  scheduled=2026-09-16T15:00:00.000Z  amount=633  provider=cmtonpi3x03sntz38n699jwyu  order=none  gatewayPayment=none
      → appointment 2026-09-16T15:00:00.000Z already passed, unpaid
  HOMIGO-20260905-00122  id=cmtonpkt3040etz38fyjtfava  scheduled=2026-09-17T23:00:00.000Z  amount=633  provider=cmtonpi3x03sntz38n699jwyu  order=none  gatewayPayment=none
      → appointment 2026-09-17T23:00:00.000Z already passed, unpaid
  HOMIGO-20260905-00133  id=cmtonq2oy0fhytz381yk7tex8  scheduled=2026-09-19T03:00:00.000Z  amount=633  provider=cmtonpi3x03sntz38n699jwyu  order=none  gatewayPayment=none
      → appointment 2026-09-19T03:00:00.000Z already passed, unpaid

## PAYMENT_NOT_FOUND (2)
  HOMIGO-20260905-00059  id=cmtonpbrj02pntz38bt77jynw  scheduled=2026-10-04T15:00:00.000Z  amount=633  provider=cmtonpb7u02eftz38wfebg02w  order=none  gatewayPayment=none
      → no payment row and no gateway order: checkout was never started
  HOMIGO-20260905-00111  id=cmtonphx903qatz38mk7jh7ea  scheduled=2026-09-30T17:00:00.000Z  amount=633  provider=cmtonpho403p4tz38np3l1uug  order=none  gatewayPayment=none
      → no payment row and no gateway order: checkout was never started

## PAYMENT_INDETERMINATE (1)
  HOMIGO-20260609-00003  id=cmq6ukf0s001htzocenleqt3u  scheduled=2026-06-22T03:30:00.000Z  amount=550  provider=cmq6ukegr0005tzoczxey43xt  order=order_dev_f75d00678a3dfca7  gatewayPayment=none
      → gateway order order_dev_f75d00678a3dfca7 exists and is unsettled — only the gateway can resolve it

Remediation guidance: only individually justified action may alter any of these rows.
PAYMENT_INDETERMINATE is the only class that needs a gateway question before any decision.
