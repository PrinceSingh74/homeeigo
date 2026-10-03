"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "@/services/agents-api";

/**
 * Query keys for the Phase-16 agent surface.
 *
 * The overview is polled rather than cached long, because the value it reports — the mode each
 * agent is actually in — changes underneath the operator: a flag flip, a kill switch, or an
 * environment change all move it without any action in this UI. A stale "LIVE" badge next to an
 * agent someone has just disabled is worse than no badge at all.
 */
export const agentKeys = {
  overview: ["agents", "overview"] as const,
  runs: (filters: { agentId?: string; status?: string }) => ["agents", "runs", filters] as const,
  run: (runId: string) => ["agents", "run", runId] as const,
  orphans: ["agents", "orphans"] as const,
};

export function useAgentOverviewQuery() {
  return useQuery({
    queryKey: agentKeys.overview,
    queryFn: () => agentsApi.overview(),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useAgentRunsQuery(filters: { agentId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: agentKeys.runs(filters),
    queryFn: () => agentsApi.runs({ ...filters, limit: 50 }),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  });
}

export function useAgentRunQuery(runId: string | null) {
  return useQuery({
    queryKey: agentKeys.run(runId ?? ""),
    queryFn: () => agentsApi.run(runId!),
    enabled: Boolean(runId),
    // A completed run is immutable, so there is nothing to poll for.
    staleTime: 60_000,
  });
}

export function useAgentOrphansQuery() {
  return useQuery({
    queryKey: agentKeys.orphans,
    queryFn: () => agentsApi.orphans(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useStartAgentRunMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      agentId: string;
      goal: string;
      input?: string;
      mode?: "shadow";
      intent?: string;
    }) =>
      agentsApi.startRun(vars.agentId, {
        goal: vars.goal,
        input: vars.input,
        mode: vars.mode,
        intent: vars.intent,
      }),
    onSuccess: () => {
      // The run list and the orphan count both move when a run starts; the overview does not.
      void qc.invalidateQueries({ queryKey: ["agents", "runs"] });
      void qc.invalidateQueries({ queryKey: agentKeys.orphans });
    },
  });
}
