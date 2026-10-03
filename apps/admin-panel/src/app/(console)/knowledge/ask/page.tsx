"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { DataUnavailable, SectionHeading } from "@/components/hq/primitives";
import { knowledgeApi, type GroundedAnswer, type RetrievalResult } from "@/services/knowledge-api";
import { cn } from "@/lib/cn";

/**
 * Phase-11 Knowledge Assistant — asking the knowledge base and seeing exactly what answered.
 *
 * ── What this page refuses to do ───────────────────────────────────────────────
 *
 * It never presents an answer as more settled than the backend said it was. The four answer kinds
 * are visually distinct and the two that are *not* answers — a refusal, and sources that disagree —
 * are not dressed up as success. A knowledge console whose failure states look like results is the
 * specific way these systems mislead the people who trust them most.
 *
 * Retrieval diagnostics are shown alongside, because the useful question when an answer looks wrong
 * is almost never "what did the model say" but "what was it given, and why that".
 */

const KIND_STYLE: Record<GroundedAnswer["kind"], { label: string; tone: string; note: string }> = {
  KNOWLEDGE: {
    label: "Grounded answer",
    tone: "border-emerald-400/30 bg-emerald-400/5",
    note: "Answered from the cited approved sources.",
  },
  REQUIRES_LIVE_DATA: {
    label: "Policy only — not this customer's status",
    tone: "border-blue-400/30 bg-blue-400/5",
    note: "This states what the policy says. It does not state the status of any specific booking, payment or refund.",
  },
  REQUIRES_HUMAN_REVIEW: {
    label: "Sources disagree — human review",
    tone: "border-amber-400/30 bg-amber-400/5",
    note: "Approved sources were found and read, and they conflict. No answer was stated.",
  },
  REFUSAL: {
    label: "Not answered",
    tone: "border-slate-400/30 bg-slate-400/5",
    note: "Nothing was answered. The reason is stated rather than filled in from general knowledge.",
  },
};

export default function KnowledgeAskPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null);
  const [diagnostics, setDiagnostics] = useState<RetrievalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: (q: string) => knowledgeApi.ask(q),
    onMutate: () => {
      setError(null);
      setAnswer(null);
      setDiagnostics(null);
    },
    onSuccess: (a) => setAnswer(a),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "The request failed."),
  });

  const retrieve = useMutation({
    mutationFn: (q: string) => knowledgeApi.retrieve(q),
    onMutate: () => {
      setError(null);
      setAnswer(null);
      setDiagnostics(null);
    },
    onSuccess: (r) => setDiagnostics(r),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "The request failed."),
  });

  const busy = ask.isPending || retrieve.isPending;
  const retrieval = answer?.retrieval ?? diagnostics;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold">Knowledge Assistant</h1>
        <p className="mt-1 text-sm text-[var(--color-biz-muted)]">
          Ask the approved knowledge base. Answers are grounded in cited sources or not given at all —
          nothing here is answered from the model&apos;s general knowledge.
        </p>
      </header>

      <GlassPanel className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim().length >= 3) ask.mutate(question.trim());
          }}
        >
          <label htmlFor="kb-question" className="text-xs text-[var(--color-biz-muted)]">
            Question
          </label>
          <textarea
            id="kb-question"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. When is a cancellation free?"
            className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-transparent px-3 py-2 text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy || question.trim().length < 3}
              className="rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-medium hover:bg-white/5 disabled:opacity-50"
            >
              {ask.isPending ? "Asking…" : "Ask"}
            </button>
            <button
              type="button"
              disabled={busy || question.trim().length < 3}
              onClick={() => retrieve.mutate(question.trim())}
              className="rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-medium hover:bg-white/5 disabled:opacity-50"
            >
              {retrieve.isPending ? "Retrieving…" : "Retrieve only (no model call)"}
            </button>
            <span className="text-[11px] text-[var(--color-biz-muted)]">
              Retrieval-only shows what would be given to the model, without spending a call.
            </span>
          </div>
        </form>
      </GlassPanel>

      {error ? (
        <DataUnavailable title="The request failed" reason={error} />
      ) : null}

      {answer ? (
        <section aria-live="polite">
          <SectionHeading title="Answer" hint={KIND_STYLE[answer.kind].label} />
          <GlassPanel className={cn("border p-4", KIND_STYLE[answer.kind].tone)}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                {KIND_STYLE[answer.kind].label}
              </span>
              <span className="text-[11px] text-[var(--color-biz-muted)]">
                grounded: {String(answer.grounded)}
                {answer.refusalReason ? ` · ${answer.refusalReason.replace(/_/g, " ").toLowerCase()}` : ""}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{answer.answer}</p>
            <p className="mt-3 text-[11px] text-[var(--color-biz-muted)]">
              {KIND_STYLE[answer.kind].note}
            </p>
            <p className="mt-1 text-[11px] text-[var(--color-biz-faint)]">
              {answer.model.provider
                ? `${answer.model.provider}/${answer.model.model} · ${answer.model.latencyMs}ms`
                : "No model was called."}{" "}
              · rules {answer.rulesVersion}
            </p>
          </GlassPanel>

          {answer.limitations.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {answer.limitations.map((l) => (
                <li key={l} className="text-xs text-amber-200/90">
                  · {l}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4">
            <SectionHeading
              title="Citations"
              hint={
                answer.citations.length === 0
                  ? "none — nothing was cited"
                  : `${answer.citations.length} source(s)`
              }
            />
            {answer.citations.length === 0 ? (
              <DataUnavailable
                title="No citations"
                reason="No approved source was used, which is why nothing was stated as policy."
              />
            ) : (
              <div className="flex flex-col gap-2">
                {answer.citations.map((c) => (
                  <GlassPanel key={c.chunkId} className="p-3">
                    <p className="text-sm font-medium">{c.title}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">
                      {c.type.replace(/_/g, " ")} · {c.documentKey} · v{c.version}
                      {c.section ? ` · ${c.section}` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--color-biz-faint)]">
                      source of record: {c.sourceRef}
                    </p>
                  </GlassPanel>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {retrieval ? <RetrievalDiagnostics retrieval={retrieval} /> : null}
    </div>
  );
}

function RetrievalDiagnostics({ retrieval }: { retrieval: RetrievalResult }) {
  return (
    <section>
      <SectionHeading
        title="Retrieval"
        hint={`${retrieval.state.toLowerCase()} · ${retrieval.timings.totalMs}ms`}
      />
      <GlassPanel className="p-4">
        <div className="flex flex-wrap gap-4 text-xs">
          <span>
            lexical arm:{" "}
            <strong className={retrieval.arms.lexical ? "text-emerald-400" : "text-slate-400"}>
              {retrieval.arms.lexical ? "contributed" : "no hits"}
            </strong>{" "}
            ({retrieval.timings.lexicalMs}ms)
          </span>
          <span>
            semantic arm:{" "}
            <strong className={retrieval.arms.semantic ? "text-emerald-400" : "text-slate-400"}>
              {retrieval.arms.semantic ? "ran" : "did not run"}
            </strong>{" "}
            ({retrieval.timings.semanticMs}ms)
          </span>
        </div>

        {retrieval.overlap ? (
          <div className="mt-3 rounded-lg border border-[var(--color-biz-line)] p-3 text-xs">
            <p className="font-medium">
              More than one policy class covered this: {retrieval.overlap.types.join(", ")}
            </p>
            <p className="mt-1 text-[var(--color-biz-muted)]">
              {retrieval.overlap.authority?.state === "POLICY_DEFINED"
                ? retrieval.overlap.authority.explanation
                : (retrieval.overlap.authority?.explanation ??
                  "No precedence is declared between these classes.")}
            </p>
            <p className="mt-1 text-[var(--color-biz-faint)]">
              Overlap on its own is normal — sources covering the same topic usually agree. Precedence
              is applied only if they turn out to contradict each other.
            </p>
          </div>
        ) : null}

        {retrieval.chunks.length === 0 ? (
          <div className="mt-3">
            <DataUnavailable
              title="No approved source matched"
              reason="Nothing you are permitted to read covers this question. Nothing was answered from elsewhere."
            />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Retrieved sources table">
            <table className="w-full min-w-[760px] text-xs">
              <caption className="sr-only">Retrieved chunks with their measured ranking</caption>
              <thead>
                <tr className="text-left uppercase tracking-wide text-[var(--color-biz-muted)]">
                  <th scope="col" className="pb-2 font-semibold">Source</th>
                  <th scope="col" className="pb-2 font-semibold">Class</th>
                  <th scope="col" className="pb-2 font-semibold">Lexical</th>
                  <th scope="col" className="pb-2 font-semibold">Semantic</th>
                  <th scope="col" className="pb-2 font-semibold">Fused</th>
                </tr>
              </thead>
              <tbody>
                {retrieval.chunks.map((c) => (
                  <tr key={c.chunkId} className="border-t border-[var(--color-biz-line)] align-top">
                    <td className="py-2">
                      <p className="font-medium">{c.title}</p>
                      <p className="text-[var(--color-biz-muted)]">
                        {c.documentKey} v{c.version}
                        {c.section ? ` · ${c.section}` : ""}
                      </p>
                    </td>
                    <td className="py-2">{c.type.replace(/_/g, " ")}</td>
                    <td className="py-2 tabular-nums">
                      {c.lexicalRank === null ? (
                        <span className="text-[var(--color-biz-faint)]">—</span>
                      ) : (
                        `#${c.lexicalRank} (${c.lexicalScore?.toFixed(4)})`
                      )}
                    </td>
                    <td className="py-2 tabular-nums">
                      {c.semanticRank === null ? (
                        <span className="text-[var(--color-biz-faint)]">—</span>
                      ) : (
                        `#${c.semanticRank} (${c.semanticScore?.toFixed(4)})`
                      )}
                    </td>
                    <td className="py-2 tabular-nums">{c.fusedScore.toFixed(5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-[var(--color-biz-faint)]">
              Fused score is a reciprocal-rank-fusion ranking number. It is not a probability that the
              answer is correct, and a dash means that arm did not return this chunk.
            </p>
          </div>
        )}
      </GlassPanel>
    </section>
  );
}
