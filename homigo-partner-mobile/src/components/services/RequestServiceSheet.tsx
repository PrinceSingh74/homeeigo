import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ResultBanner } from "@/components/account/states";
import { FormLabel, RadioRows } from "@/components/credentials/parts";
import { Button, Field, Sheet, T } from "@/components/ui";
import { CAPABILITIES_KEY, SERVICE_BOARD_KEY } from "@/hooks/credentials/queries";
import { AVAILABLE_LIMIT, requestOutcome, searchAvailable, serviceFailure, type Notice } from "@/lib/services-screen";
import { partnerApi } from "@/services/partner-api";
import type { PartnerServiceSkillCard } from "@/types/partner";

/**
 * Ask to perform one more catalogue service: `POST /api/providers/me/capabilities/services` with
 * `{ serviceId, note? }` (note at most 300 characters). The answer is always a REQUESTED row — an
 * administrator approves it — or `changed: false` when one already existed; the sentence shown comes
 * from that answer. Whatever happens, the board is read again.
 */
export function RequestServiceSheet({ available, onClose, onDone }: { available: ReadonlyArray<PartnerServiceSkillCard>; onClose: () => void; onDone: (notice: Notice) => void }) {
  const qc = useQueryClient();
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<Notice | null>(null);
  const request = useMutation({
    mutationFn: (id: string) => partnerApi.requestServiceSkill(id, note.trim() || undefined),
    onMutate: () => setProblem(null),
    onSuccess: (res) => {
      onDone(requestOutcome(res));
      onClose();
    },
    onError: (e) => setProblem(serviceFailure(e)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: SERVICE_BOARD_KEY });
      // The credentials summary counts open service requests.
      void qc.invalidateQueries({ queryKey: CAPABILITIES_KEY });
    },
  });
  const { shown, total } = searchAvailable(available, search);
  // A choice hidden by a later search is no longer the choice: the button names what is on screen.
  const chosen = shown.find((s) => s.serviceId === serviceId) ?? null;

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Request a service"
      dismissable={!request.isPending}
      testID="service-request-sheet"
      footer={
        <Button
          label="Request approval"
          onPress={() => (chosen ? request.mutate(chosen.serviceId) : undefined)}
          loading={request.isPending}
          disabled={!chosen}
          hint={chosen ? null : "Choose a service first."}
          accessibilityLabel={chosen ? `Request approval for ${chosen.name}` : "Request approval"}
          testID="service-request-submit"
        />
      }
    >
      <T kind="small">Ask for a service you can now do. You are offered its jobs only after the Homeeigo team approves it.</T>
      <Field label="Search services" value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} editable={!request.isPending} testID="service-request-search" />
      <FormLabel>Service</FormLabel>
      {total === 0 ? <T kind="small">No services match that search.</T> : null}
      <RadioRows
        label="Service"
        options={shown.map((s) => ({ id: s.serviceId, label: s.name, detail: s.category, testID: `service-available-${s.serviceId}` }))}
        value={chosen?.serviceId ?? null}
        onChange={setServiceId}
        disabled={request.isPending}
      />
      {total > AVAILABLE_LIMIT ? <T kind="small">{`Showing ${AVAILABLE_LIMIT} of ${total}. Search to narrow the list.`}</T> : null}
      <Field label="Why you are ready (optional)" value={note} onChangeText={setNote} maxLength={300} multiline editable={!request.isPending} testID="service-request-note" />
      <ResultBanner result={problem} testID="service-request-error" />
    </Sheet>
  );
}
