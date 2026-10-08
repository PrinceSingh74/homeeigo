import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuthed } from "@/hooks/account/queries";
import { capabilityFailure, type Failure } from "@/lib/credentials-screen";
import { partnerApi } from "@/services/partner-api";

/**
 * The reads and writes of "My credentials" and "My services". The keys are the ones the rest of the
 * app already uses, so a write here refreshes every screen showing the same data.
 */

export const CAPABILITIES_KEY = ["partner", "capabilities"] as const;
export const SERVICE_BOARD_KEY = ["partner", "service-skills"] as const;
export const DOCUMENTS_KEY = ["partner", "documents"] as const;

/** `GET /api/providers/me/capabilities` — every credential row, the summary and the catalogues. */
export function useCapabilityProfileQuery() {
  const enabled = useAuthed();
  return useQuery({ queryKey: CAPABILITIES_KEY, queryFn: () => partnerApi.capabilities.profile(), enabled });
}

/** `GET /api/providers/me/documents` — a certification or insurance claim can point at one as proof. */
export function useDocumentsQuery(enabled = true) {
  const authed = useAuthed();
  return useQuery({ queryKey: DOCUMENTS_KEY, queryFn: () => partnerApi.documents.list(), enabled: authed && enabled });
}

/** `GET /api/providers/me/service-skills` — the services by lane, with readiness on the performing ones. */
export function useServiceBoardQuery() {
  const enabled = useAuthed();
  return useQuery({ queryKey: SERVICE_BOARD_KEY, queryFn: () => partnerApi.serviceSkills(), enabled });
}

/**
 * One capability write. It keeps its own failure (offline told apart from a refusal) and re-reads the
 * profile and the service board whether it worked or not: a `CAPABILITY_LOCKED` answer means the list
 * on screen is out of date, and a credential change can change which services are ready.
 */
export function useCapabilityWrite<V, R>(fn: (vars: V) => Promise<R>, onDone?: (result: R, vars: V) => void) {
  const qc = useQueryClient();
  const [problem, setProblem] = useState<Failure | null>(null);
  const mutation = useMutation({
    mutationFn: fn,
    onMutate: () => setProblem(null),
    onSuccess: (result, vars) => onDone?.(result, vars),
    onError: (e) => setProblem(capabilityFailure(e)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: CAPABILITIES_KEY });
      void qc.invalidateQueries({ queryKey: SERVICE_BOARD_KEY });
    },
  });
  return { run: mutation.mutate, busy: mutation.isPending, variables: mutation.variables, problem, clearProblem: () => setProblem(null) };
}
