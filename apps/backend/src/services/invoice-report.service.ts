import { prisma } from "../lib/prisma";
import { PaymentStatus, GiftCardStatus } from "@prisma/client";
import { analyticsWhereVia } from "../lib/analytics-scope";
import { CREDITED_EARNING_WHERE, earningInvoiceNumber, partnerEarningLines, partnerJobEarningView, type PartnerJobEarning } from "../lib/earning-settlement";

/**
 * Partner-side ESTIMATE shown on the partner tax report (applied to net earnings). It is NOT the
 * customer tax on bookings — that is lib/pricing-policy TAX_POLICY — and must not be coupled to it.
 * Value unchanged from the original constant.
 */
const TAX_RATE = 0.1;

function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export class InvoiceReportService {
  // ===== Admin: unified invoice list (payments — the billable revenue events) =====
  private invoiceWhere(search?: string) {
    const base = { status: { in: [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED] } };
    if (!search?.trim()) return base;
    const q = search.trim();
    return {
      ...base,
      OR: [
        { invoiceNumber: { contains: q, mode: "insensitive" as const } },
        { user: { firstName: { contains: q, mode: "insensitive" as const } } },
        { user: { lastName: { contains: q, mode: "insensitive" as const } } },
        { user: { email: { contains: q, mode: "insensitive" as const } } },
      ],
    };
  }

  private async invoiceRows(where: object, skip: number, take: number) {
    const rows = await prisma.payment.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        booking: { include: { service: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
    return rows.map((p) => ({
      id: p.id,
      invoiceNumber: p.invoiceNumber ?? `INV-${p.id.slice(-8).toUpperCase()}`,
      customer: [p.user.firstName, p.user.lastName].filter(Boolean).join(" ") || p.user.email,
      email: p.user.email,
      service: p.booking?.service?.name ?? "Service",
      amount: p.amountPaid || p.amount,
      refunded: p.refundedAmount,
      status: p.refundedAmount > 0 ? "refunded" : "paid",
      date: p.completedAt ?? p.createdAt,
    }));
  }

  async adminInvoices(query: { page?: string; limit?: string; search?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where = this.invoiceWhere(query.search);
    const [rows, total] = await Promise.all([
      this.invoiceRows(where, (page - 1) * limit, limit),
      prisma.payment.count({ where }),
    ]);
    return { invoices: rows, pagination: { page, limit, total, hasMore: page * limit < total } };
  }

  async adminInvoicesCsv(search?: string): Promise<string> {
    const where = this.invoiceWhere(search);
    const rows = await this.invoiceRows(where, 0, 5000);
    const header = ["Invoice", "Customer", "Email", "Service", "Amount", "Refunded", "Status", "Date"];
    const lines = rows.map((r) =>
      [r.invoiceNumber, r.customer, r.email, r.service, r.amount, r.refunded, r.status, new Date(r.date).toISOString()]
        .map(csvCell)
        .join(","),
    );
    return [header.join(","), ...lines].join("\n");
  }

  /** Revenue report across every stream + refund tracking. */
  async adminRevenueReport() {
    // A business revenue report: every stream and the refunds netted against it use the one
    // population policy, so certification payments and their refunds are not revenue.
    const [paid, refunds, subs, gifts] = await Promise.all([
      prisma.payment.aggregate({ where: { status: { in: [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED] }, ...analyticsWhereVia("payment") }, _sum: { amountPaid: true }, _count: { _all: true } }),
      prisma.payment.aggregate({ where: analyticsWhereVia("payment"), _sum: { refundedAmount: true } }),
      prisma.subscriptionInvoice.aggregate({ where: { status: "paid", subscription: analyticsWhereVia("userSubscription") }, _sum: { amount: true }, _count: { _all: true } }),
      prisma.giftCard.aggregate({ where: { status: { not: GiftCardStatus.PENDING_PAYMENT }, ...analyticsWhereVia("giftCard") }, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    const bookings = paid._sum.amountPaid ?? 0;
    const subscriptions = subs._sum.amount ?? 0;
    const giftCards = gifts._sum.amount ?? 0;
    const refunded = refunds._sum.refundedAmount ?? 0;
    const gross = bookings + subscriptions + giftCards;
    return {
      streams: { bookings, subscriptions, giftCards },
      counts: { bookings: paid._count._all, subscriptions: subs._count._all, giftCards: gifts._count._all },
      grossRevenue: gross,
      refunds: refunded,
      netRevenue: gross - refunded,
    };
  }

  // ===== Partner: earnings invoices + settlement invoices + tax =====
  private async serviceNamesByBookingIds(bookingIds: string[]): Promise<Map<string, string>> {
    if (bookingIds.length === 0) return new Map();
    const bookings = await prisma.booking.findMany({
      where: { id: { in: bookingIds } },
      select: { id: true, service: { select: { name: true } } },
    });
    return new Map(bookings.map((b) => [b.id, b.service?.name ?? "Service"]));
  }

  async partnerInvoices(providerId: string) {
    const [earnings, withdrawals] = await Promise.all([
      prisma.earning.findMany({ where: { providerId }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.withdrawal.findMany({ where: { providerId }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    const svcByBooking = await this.serviceNamesByBookingIds(
      earnings.map((e) => e.bookingId).filter((id): id is string => !!id),
    );
    return {
      earnings: earnings.map((e) => ({
        id: e.id,
        invoiceNumber: earningInvoiceNumber(e.id),
        service: (e.bookingId && svcByBooking.get(e.bookingId)) || "Service",
        gross: e.grossAmount,
        commission: e.commission,
        net: e.netEarning,
        date: e.createdAt,
      })),
      settlements: withdrawals.map((w) => ({
        id: w.id,
        settlementNumber: w.withdrawalNumber,
        amount: w.amount,
        netAmount: w.netAmount,
        status: w.status.toLowerCase(),
        date: w.createdAt,
      })),
    };
  }

  async partnerTaxSummary(providerId: string) {
    const agg = await prisma.earning.aggregate({
      where: { providerId, ...CREDITED_EARNING_WHERE },
      _sum: { grossAmount: true, commission: true, netEarning: true },
    });
    const settled = await prisma.withdrawal.aggregate({
      where: { providerId, status: "COMPLETED" },
      _sum: { netAmount: true },
    });
    const gross = agg._sum.grossAmount ?? 0;
    const commission = agg._sum.commission ?? 0;
    const net = agg._sum.netEarning ?? 0;
    const estimatedTax = Math.round(net * TAX_RATE);
    return {
      financialYear: new Date().getFullYear(),
      grossEarnings: gross,
      platformCommission: commission,
      netEarnings: net,
      settledOut: settled._sum.netAmount ?? 0,
      estimatedTax,
      gstOnCommission: Math.round(commission * 0.18),
      tdsEstimate: estimatedTax,
    };
  }

  /**
   * Phase 13 P2 — what THIS job paid the partner, for the job page. The row exists only once the
   * job is completed and paid out (`booking.service.ts` writes it in the completion transaction);
   * before that there is nothing to show and nothing is estimated. `null` = no earning recorded for
   * this booking and partner (not completed, a waived rework / revisit, or not this partner's job).
   */
  async partnerBookingEarning(providerId: string, bookingId: string): Promise<PartnerJobEarning | null> {
    const e = await prisma.earning.findFirst({
      where: { bookingId, providerId },
      select: { id: true, bookingId: true, grossAmount: true, commission: true, netEarning: true, paymentStatus: true, createdAt: true },
    });
    return e ? partnerJobEarningView(e) : null;
  }

  /** Printable HTML invoice for a partner earning. */
  async partnerEarningHtml(providerId: string, earningId: string): Promise<string | null> {
    const e = await prisma.earning.findFirst({
      where: { id: earningId, providerId },
      include: { provider: { include: { user: { select: { firstName: true, lastName: true } } } } },
    });
    if (!e) return null;
    const svc = e.bookingId ? (await this.serviceNamesByBookingIds([e.bookingId])).get(e.bookingId) : null;
    const serviceName = svc ?? "Service";
    const name = [e.provider.user.firstName, e.provider.user.lastName].filter(Boolean).join(" ");
    const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
    /**
     * `Earning.netEarning` is written as `finalAmount - commission + bonus - deduction`
     * (`earnings.service.ts` — performance bonuses like the perfect-rating ₹50, and deductions,
     * both computed at completion time), but only `grossAmount`/`commission`/`netEarning` are ever
     * persisted on this row — `bonus`/`deduction` themselves are not columns on `Earning` and go
     * only to the financial ledger. Gross minus commission has therefore never equalled the shown
     * net whenever either was non-zero, with nothing on the invoice explaining the gap — exactly
     * the "why doesn't this add up" a partner (or anyone checking the math) would hit. The
     * adjustment is derived from the three values that *are* stored (`partnerEarningLines`, which
     * the job page's earnings line reads too), so it is correct for every historical row without a
     * migration or backfill.
     */
    const rows = partnerEarningLines(e)
      .filter((l) => l.key !== "net")
      .map((l) => `<div class="row"><span>${l.label}</span><span>${l.kind === "debit" ? "− " : l.kind === "credit" ? "+ " : ""}${inr(l.amount)}</span></div>`)
      .join("\n");
    return `<!doctype html><html><head><meta charset="utf-8"><title>Earning ${earningInvoiceNumber(e.id)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;color:#1f2937;padding:0 16px}
.h{display:flex;justify-content:space-between;border-bottom:2px solid #7C3AED;padding-bottom:12px}
.brand{font-size:24px;font-weight:800;color:#7C3AED}.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee}
.total{font-weight:800;font-size:18px;border-top:2px solid #1f2937;margin-top:8px}@media print{.noprint{display:none}}</style></head>
<body><div class="h"><div class="brand">HOMEEIGO</div><div><b>Earning invoice</b><br>${earningInvoiceNumber(e.id)}<br>${new Date(e.createdAt).toLocaleDateString("en-IN")}</div></div>
<p>Partner: <b>${name}</b></p><p>Service: <b>${serviceName}</b></p>
${rows}
<div class="row total"><span>Net earning</span><span>${inr(e.netEarning)}</span></div>
<p class="noprint" style="text-align:center;margin-top:24px"><button onclick="print()" style="background:#7C3AED;color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer">Download / Print PDF</button></p>
</body></html>`;
  }
}

export const invoiceReportService = new InvoiceReportService();
