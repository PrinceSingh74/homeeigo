import { FileText, Receipt } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { failureSentence } from "@/components/money/DataScreen";
import { Banner, Button, Card, EmptyState, KeyValue, ListRow, Sheet, Skeleton, T } from "@/components/ui";
import { useEarningInvoiceQuery } from "@/hooks/money/queries";
import { formatDay, rupees } from "@/lib/money-format";
import { parseEarningInvoiceHtml } from "@/lib/money-invoice";
import { pageOf } from "@/lib/money-series";
import { color, space } from "@/theme/tokens";
import type { PartnerEarningInvoice } from "@/types/partner";

const PAGE = 10;

/**
 * One row per paid job (`GET /api/providers/me/invoices` → `earnings`, the latest 100). A row opens
 * that job's figures and its invoice. The list also carries earnings that were later reversed and
 * sends nothing that marks them, so the screen says exactly that instead of implying every row was
 * kept.
 */
export function JobEarningsList({ earnings }: { earnings: PartnerEarningInvoice[] }) {
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<PartnerEarningInvoice | null>(null);
  const { visible, hidden } = pageOf(earnings, shown);

  if (earnings.length === 0) {
    return (
      <Card>
        <EmptyState icon={Receipt} title="No job earnings yet" message="When a job is completed and paid, what it earned you appears here." testID="job-earnings-empty" />
      </Card>
    );
  }

  return (
    <>
      <Card testID="job-earnings-list">
        {visible.map((e, i) => (
          <ListRow
            key={e.id}
            testID={`job-earning-row-${i}`}
            icon={Receipt}
            tone="warning"
            title={e.service}
            subtitle={`${e.invoiceNumber} · ${formatDay(e.date)}`}
            value={rupees(e.net)}
            onPress={() => setOpen(e)}
            last={i === visible.length - 1 && hidden === 0}
          />
        ))}
        {hidden > 0 ? <Button label={`Show ${Math.min(PAGE, hidden)} more`} variant="quiet" onPress={() => setShown((n) => n + PAGE)} testID="job-earnings-more" /> : null}
      </Card>
      <T kind="small">
        {`Showing ${visible.length} of the ${earnings.length} most recent. The server lists at most 100 and includes earnings that were later reversed without marking them.`}
      </T>
      <EarningDetailSheet earning={open} onClose={() => setOpen(null)} />
    </>
  );
}

function EarningDetailSheet({ earning, onClose }: { earning: PartnerEarningInvoice | null; onClose: () => void }) {
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null);
  const showInvoice = Boolean(earning) && invoiceFor === earning?.id;
  const invoice = useEarningInvoiceQuery(showInvoice && earning ? earning.id : null);
  const parsed = useMemo(() => (typeof invoice.data === "string" ? parseEarningInvoiceHtml(invoice.data) : null), [invoice.data]);

  if (!earning) return null;
  const close = () => {
    setInvoiceFor(null);
    onClose();
  };

  return (
    <Sheet
      visible
      onClose={close}
      title="Job earning"
      testID="job-earning-detail"
      footer={
        <>
          {showInvoice ? null : <Button label="View invoice" icon={FileText} variant="secondary" onPress={() => setInvoiceFor(earning.id)} testID="job-earning-view-invoice" />}
          <Button label="Close" variant="quiet" onPress={close} />
        </>
      }
    >
      <View>
        <T kind="bodyStrong">{earning.service}</T>
        <T kind="small" numeric>{`${earning.invoiceNumber} · ${formatDay(earning.date)}`}</T>
      </View>

      <View style={styles.group}>
        <KeyValue label="Gross amount" value={rupees(earning.gross)} />
        <KeyValue label="Platform commission" value={`− ${rupees(earning.commission)}`} />
        <KeyValue label="Net earning" value={rupees(earning.net)} strong />
      </View>
      <T kind="small">A bonus or an adjustment, when the job had one, is itemised on the invoice.</T>

      {showInvoice ? (
        <View style={styles.group} testID="job-earning-invoice">
          <T kind="smallStrong" tone="slate" accessibilityRole="header">
            Invoice
          </T>
          {invoice.isPending ? (
            <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading invoice…" style={styles.loading}>
              <Skeleton height={14} />
              <Skeleton height={14} width="80%" />
              <Skeleton height={14} width="60%" />
            </View>
          ) : invoice.isError ? (
            <Banner
              tone="danger"
              message={failureSentence(invoice.error)}
              action={<Button label="Try again" variant="secondary" onPress={() => void invoice.refetch()} />}
              testID="job-earning-invoice-error"
            />
          ) : parsed ? (
            <>
              {parsed.invoiceNumber ? <KeyValue label="Invoice number" value={parsed.invoiceNumber} /> : null}
              {parsed.partner ? <KeyValue label="Partner" value={parsed.partner} /> : null}
              {parsed.service ? <KeyValue label="Service" value={parsed.service} /> : null}
              <View style={styles.invoiceLines}>
                {parsed.lines.map((l, i) => (
                  <KeyValue key={`${l.label}-${i}`} label={l.label} value={l.value} strong={l.total} />
                ))}
              </View>
              <T kind="small">These are the lines of the invoice as HOMEEIGO issued it.</T>
            </>
          ) : (
            <Banner tone="info" message="The invoice was received but cannot be displayed in the app. The figures above are from the same earning." testID="job-earning-invoice-unreadable" />
          )}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  group: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, paddingTop: space.md, gap: space.xs },
  invoiceLines: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, marginTop: space.sm, paddingTop: space.sm },
  loading: { gap: space.sm },
});
