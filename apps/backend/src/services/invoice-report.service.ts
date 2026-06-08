import { prisma } from "../lib/prisma";
import { PaymentStatus, GiftCardStatus } from "@prisma/client";

const TAX_RATE = 0.1; // GST component already baked into finalAmount

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
    const [paid, refunds, subs, gifts] = await Promise.all([
      prisma.payment.aggregate({ where: { status: { in: [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED] } }, _sum: { amountPaid: true }, _count: { _all: true } }),
      prisma.payment.aggregate({ _sum: { refundedAmount: true } }),
      prisma.subscriptionInvoice.aggregate({ where: { status: "paid" }, _sum: { amount: true }, _count: { _all: true } }),
      prisma.giftCard.aggregate({ where: { status: { not: GiftCardStatus.PENDING_PAYMENT } }, _sum: { amount: true }, _count: { _all: true } }),
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
        invoiceNumber: `ERN-${e.id.slice(-8).toUpperCase()}`,
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
      where: { providerId },
      _sum: { grossAmount: true, commission: true, netEarning: true },
    });
    const settled = await prisma.withdrawal.aggregate({
      where: { providerId, status: "COMPLETED" },
      _sum: { netAmount: true },
    });
    const gross = agg._sum.grossAmount ?? 0;
    const net = agg._sum.netEarning ?? 0;
    return {
      financialYear: new Date().getFullYear(),
      grossEarnings: gross,
      platformCommission: agg._sum.commission ?? 0,
      netEarnings: net,
      settledOut: settled._sum.netAmount ?? 0,
      estimatedTax: Math.round(net * TAX_RATE),
    };
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
    return `<!doctype html><html><head><meta charset="utf-8"><title>Earning ERN-${e.id.slice(-8).toUpperCase()}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;color:#1f2937;padding:0 16px}
.h{display:flex;justify-content:space-between;border-bottom:2px solid #7C3AED;padding-bottom:12px}
.brand{font-size:24px;font-weight:800;color:#7C3AED}.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee}
.total{font-weight:800;font-size:18px;border-top:2px solid #1f2937;margin-top:8px}@media print{.noprint{display:none}}</style></head>
<body><div class="h"><div class="brand">HOMIGO</div><div><b>Earning invoice</b><br>ERN-${e.id.slice(-8).toUpperCase()}<br>${new Date(e.createdAt).toLocaleDateString("en-IN")}</div></div>
<p>Partner: <b>${name}</b></p><p>Service: <b>${serviceName}</b></p>
<div class="row"><span>Gross amount</span><span>${inr(e.grossAmount)}</span></div>
<div class="row"><span>Platform commission</span><span>− ${inr(e.commission)}</span></div>
<div class="row total"><span>Net earning</span><span>${inr(e.netEarning)}</span></div>
<p class="noprint" style="text-align:center;margin-top:24px"><button onclick="print()" style="background:#7C3AED;color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer">Download / Print PDF</button></p>
</body></html>`;
  }
}

export const invoiceReportService = new InvoiceReportService();
