"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { DataUnavailable, HqLoading, SectionHeading } from "@/components/hq/primitives";
import {
  knowledgeApi,
  KNOWLEDGE_TYPES,
  type EvaluationRun,
  type KnowledgeAnalytics,
  type KnowledgeAudience,
  type KnowledgeDocumentRow,
  type KnowledgeType,
} from "@/services/knowledge-api";
import { cn } from "@/lib/cn";

/**
 * Phase-11 Knowledge Base — the governance surface for what the platform will state as policy.
 *
 * Every number, status and document on this page comes from `/api/admin/knowledge/*`. There is no
 * placeholder row, no sample document and no hardcoded count: when a knowledge type has no content,
 * the page says so and names what is missing, because a knowledge console that shows plausible
 * example documents is worse than one that shows nothing.
 *
 * Backend authorisation is authoritative. This page renders controls it cannot itself authorise —
 * a request that the RBAC layer rejects surfaces as an error here rather than being pre-empted by a
 * hidden button, so an operator learns what they may actually do from the system of record.
 */

const STATUS_TONE: Record<string, string> = {
  APPROVED: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  DRAFT: "text-slate-300 border-slate-400/30 bg-slate-400/10",
  IN_REVIEW: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  SUPERSEDED: "text-slate-400 border-slate-500/30 bg-slate-500/10",
  WITHDRAWN: "text-red-300 border-red-400/30 bg-red-400/10",
};

const INDEX_TONE: Record<string, string> = {
  INDEXED: "text-emerald-400",
  EMBEDDED: "text-blue-300",
  CHUNKED: "text-amber-300",
  NOT_INDEXED: "text-slate-400",
  EMBEDDING_FAILED: "text-red-300",
  INDEX_FAILED: "text-red-300",
};

function Pill({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        className ?? "border-[var(--color-biz-line)] text-[var(--color-biz-muted)]",
      )}
    >
      {label}
    </span>
  );
}

export default function KnowledgeBasePage() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const documents = useQuery({
    queryKey: ["admin", "knowledge", "documents"],
    queryFn: () => knowledgeApi.listDocuments(),
  });
  const authority = useQuery({
    queryKey: ["admin", "knowledge", "authority"],
    queryFn: () => knowledgeApi.listAuthority(),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "knowledge"] });
  };
  const act = <T,>(fn: () => Promise<T>, describe: (r: T) => string) =>
    fn()
      .then((r) => {
        setNotice({ tone: "ok", text: describe(r) });
        invalidate();
      })
      .catch((e: unknown) => {
        setNotice({ tone: "err", text: e instanceof Error ? e.message : "Request failed." });
      });

  const rows = useMemo(() => documents.data ?? [], [documents.data]);

  /**
   * Coverage across the seven knowledge classes, computed from the rows themselves.
   *
   * A type with no approved, indexed document is reported as missing and named. That is the honest
   * state of this platform for Partner SOP, and hiding it behind an empty table would make a gap
   * that needs a real document look like a page that had not loaded.
   */
  const coverage = useMemo(
    () =>
      KNOWLEDGE_TYPES.map((type) => {
        const forType = rows.filter((d) => d.type === type);
        const approved = forType.filter((d) => d.status === "APPROVED");
        const indexed = approved.filter((d) => d.indexState === "INDEXED");
        return {
          type,
          total: forType.length,
          approved: approved.length,
          indexed: indexed.length,
          chunks: indexed.reduce((n, d) => n + d.chunkCount, 0),
        };
      }),
    [rows],
  );

  const missing = coverage.filter((c) => c.indexed === 0);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold">Knowledge Base</h1>
        <p className="mt-1 text-sm text-[var(--color-biz-muted)]">
          Governed sources the platform answers from. Only approved, indexed documents are
          retrievable, and only within their audience.
        </p>
      </header>

      {notice ? (
        <div
          role="status"
          className={cn(
            "rounded-xl border px-4 py-2.5 text-sm",
            notice.tone === "ok"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
              : "border-red-400/30 bg-red-400/10 text-red-200",
          )}
        >
          {notice.text}
        </div>
      ) : null}

      {/* ── Coverage ─────────────────────────────────────────────────────── */}
      <section>
        <SectionHeading title="Coverage" hint="approved and indexed, per knowledge class" />
        {documents.isLoading ? (
          <HqLoading label="Loading knowledge base…" />
        ) : documents.isError ? (
          <DataUnavailable
            title="Knowledge base unavailable"
            reason={documents.error instanceof Error ? documents.error.message : "The request failed."}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {coverage.map((c) => (
              <GlassPanel key={c.type} className="p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                  {c.type.replace(/_/g, " ")}
                </p>
                {c.indexed > 0 ? (
                  <>
                    <p className="mt-1.5 text-2xl font-semibold tabular-nums">{c.chunks}</p>
                    <p className="text-xs text-[var(--color-biz-muted)]">
                      retrievable chunks · {c.indexed} document{c.indexed === 1 ? "" : "s"}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1.5 text-sm font-medium text-amber-300">No indexed source</p>
                    <p className="text-xs text-[var(--color-biz-muted)]">
                      {c.total === 0
                        ? "No document of this class exists. Nothing can be answered from it."
                        : `${c.total} version(s) exist but none is approved and indexed.`}
                    </p>
                  </>
                )}
              </GlassPanel>
            ))}
          </div>
        )}
        {missing.length > 0 && !documents.isLoading ? (
          <p className="mt-2 text-xs text-[var(--color-biz-muted)]">
            {missing.map((m) => m.type.replace(/_/g, " ")).join(", ")} —{" "}
            {missing.length === 1 ? "this class has" : "these classes have"} no retrievable content.
            Questions in {missing.length === 1 ? "its" : "their"} area are refused rather than
            answered from something else.
          </p>
        ) : null}
      </section>

      {/* ── Index health & retrieval quality ───────────────────── */}
      <DiagnosticsSection />

      {/* ── Authority ────────────────────────────────────────────────────── */}
      <section>
        <SectionHeading title="Authority" hint="which class governs when approved sources disagree" />
        <GlassPanel className="p-4">
          {authority.isLoading ? (
            <HqLoading label="Loading authority declarations…" />
          ) : authority.isError ? (
            <DataUnavailable
              title="Authority unavailable"
              reason={authority.error instanceof Error ? authority.error.message : "The request failed."}
            />
          ) : authority.data?.empty ? (
            <div className="text-sm">
              <p className="font-medium text-amber-300">No precedence is declared.</p>
              <p className="mt-1 text-[var(--color-biz-muted)]">
                Nothing in HOMEEIGO&apos;s legal text, contracts or configuration establishes that one
                knowledge class outranks another, so none is assumed. When two approved sources
                genuinely disagree, the answer is withheld and a person decides. Declaring a rank
                below changes that — it is a governance decision, recorded in the audit log.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Authority declarations table">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Active knowledge authority declarations</caption>
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">
                    <th scope="col" className="pb-2 font-semibold">Class</th>
                    <th scope="col" className="pb-2 font-semibold">Rank</th>
                    <th scope="col" className="pb-2 font-semibold">Version</th>
                    <th scope="col" className="pb-2 font-semibold">Rationale on record</th>
                    <th scope="col" className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {authority.data?.active.map((a) => (
                    <tr key={a.type} className="border-t border-[var(--color-biz-line)]">
                      <td className="py-2 font-medium">{a.type.replace(/_/g, " ")}</td>
                      <td className="py-2 tabular-nums">{a.rank}</td>
                      <td className="py-2 tabular-nums text-[var(--color-biz-muted)]">v{a.version}</td>
                      <td className="py-2 text-xs text-[var(--color-biz-muted)]">{a.rationale}</td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          className="rounded-lg border border-[var(--color-biz-line)] px-2.5 py-1 text-xs hover:bg-white/5"
                          onClick={() => {
                            const reason = window.prompt(
                              `Revoke authority for ${a.type}? Conflicts involving it will return to human review.\n\nReason (recorded in the audit log):`,
                            );
                            if (reason && reason.trim().length >= 3) {
                              void act(
                                () => knowledgeApi.revokeAuthority(a.type, reason.trim()),
                                (r) => r.detail,
                              );
                            }
                          }}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DeclareAuthorityForm
            onDone={(text, tone) => {
              setNotice({ tone, text });
              invalidate();
            }}
          />
        </GlassPanel>
      </section>

      {/* ── Documents ────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <SectionHeading title="Documents" hint={`${rows.length} version(s)`} />
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-medium hover:bg-white/5"
              onClick={() => setShowCreate((v) => !v)}
              aria-expanded={showCreate}
            >
              {showCreate ? "Close" : "Add document"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-medium hover:bg-white/5"
              onClick={() =>
                void act(
                  () => knowledgeApi.seed(),
                  (r) =>
                    `Loaded from platform content. ${r.skipped.length} class(es) skipped: ` +
                    (r.skipped.map((s) => `${s.type} — ${s.reason}`).join("; ") || "none"),
                )
              }
            >
              Load from platform content
            </button>
          </div>
        </div>

        {showCreate ? (
          <CreateDocumentForm
            onDone={(text, tone) => {
              setNotice({ tone, text });
              invalidate();
              if (tone === "ok") setShowCreate(false);
            }}
          />
        ) : null}

        {documents.isLoading ? (
          <HqLoading label="Loading documents…" />
        ) : rows.length === 0 ? (
          <DataUnavailable
            title="No knowledge documents"
            reason="Nothing has been ingested into this environment. Load from platform content, or add a document."
          />
        ) : (
          <GlassPanel className="overflow-x-auto p-0">
            <table className="w-full min-w-[900px] text-sm">
              <caption className="sr-only">Knowledge documents and their lifecycle state</caption>
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">
                  <th scope="col" className="px-4 py-3 font-semibold">Document</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Class</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Audience</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Index</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Source</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <DocumentRow
                    key={d.id}
                    doc={d}
                    expanded={expanded === d.id}
                    onToggle={() => setExpanded((v) => (v === d.id ? null : d.id))}
                    onAct={act}
                  />
                ))}
              </tbody>
            </table>
          </GlassPanel>
        )}
      </section>
    </div>
  );
}

/**
 * Index health and retrieval quality, both read from the backend.
 *
 * ── Why the evaluation is a button ─────────────────────────────────────────────
 *
 * Analytics is a `GROUP BY` and loads with the page. The evaluation issues one retrieval per case,
 * so running it on every visit would spend real embedding calls to render a panel nobody asked for.
 *
 * ── Why a degraded run is shown as degraded ────────────────────────────────────
 *
 * The same evaluation reported 0.50 and 1.00 on one corpus twenty minutes apart, and the difference
 * was an embedding outage rather than retrieval quality. The backend reports that in `integrity`,
 * and this panel refuses to render the scores as a headline when `degraded` is true — a number that
 * measured an outage must not be read as a measurement of the system.
 */
function DiagnosticsSection() {
  const analytics = useQuery({
    queryKey: ["admin", "knowledge", "analytics"],
    queryFn: () => knowledgeApi.analytics(),
  });
  const evaluation = useMutation({ mutationFn: () => knowledgeApi.evaluation() });

  return (
    <section>
      <SectionHeading title="Index health" hint="measured from the knowledge tables themselves" />
      {analytics.isLoading ? (
        <HqLoading label="Loading index health…" />
      ) : analytics.isError ? (
        <DataUnavailable
          title="Analytics unavailable"
          reason={analytics.error instanceof Error ? analytics.error.message : "The request failed."}
        />
      ) : analytics.data?.state === "SOURCE_UNAVAILABLE" ? (
        <DataUnavailable
          title="Analytics unavailable"
          reason={analytics.data.detail ?? "The knowledge tables could not be read."}
        />
      ) : analytics.data ? (
        <AnalyticsPanels a={analytics.data} />
      ) : null}

      <div className="mt-3">
        <GlassPanel className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Retrieval evaluation</p>
              <p className="text-xs text-[var(--color-biz-muted)]">
                Runs the evaluation set against the corpus loaded here and reports which expected
                source each question actually retrieved. Access-boundary cases are scored separately,
                because a customer correctly seeing nothing is not evidence that ranking works.
              </p>
            </div>
            <button
              type="button"
              disabled={evaluation.isPending}
              onClick={() => evaluation.mutate()}
              className="rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-medium hover:bg-white/5 disabled:opacity-50"
            >
              {evaluation.isPending ? "Running…" : "Run evaluation"}
            </button>
          </div>

          {evaluation.isError ? (
            <p className="mt-3 text-sm text-red-300">
              {evaluation.error instanceof Error ? evaluation.error.message : "The run failed."}
            </p>
          ) : null}
          {evaluation.data ? <EvaluationReport run={evaluation.data} /> : null}
        </GlassPanel>
      </div>
    </section>
  );
}

function AnalyticsPanels({ a }: { a: KnowledgeAnalytics }) {
  const coverage = a.embeddingCoverage;
  const stale = a.indexConsistency.documentsMarkedIndexedWithUnembeddedChunks;

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <GlassPanel className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
            Approved documents
          </p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums">{a.approvedDocuments}</p>
          <p className="text-xs text-[var(--color-biz-muted)]">of {a.documents} version(s) stored</p>
        </GlassPanel>

        <GlassPanel className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
            Embedding coverage
          </p>
          {coverage.value === null ? (
            <>
              <p className="mt-1.5 text-sm font-medium text-amber-300">Not measurable</p>
              <p className="text-xs text-[var(--color-biz-muted)]">
                No chunks exist, so there is no denominator.
              </p>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums">
                {Math.round(coverage.value * 100)}%
              </p>
              <p className="text-xs text-[var(--color-biz-muted)]">
                {coverage.numerator} of {coverage.denominator} chunks carry a vector
              </p>
            </>
          )}
        </GlassPanel>

        <GlassPanel className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
            Index consistency
          </p>
          <p
            className={cn(
              "mt-1.5 text-2xl font-semibold tabular-nums",
              stale > 0 ? "text-red-300" : "text-emerald-400",
            )}
          >
            {stale}
          </p>
          <p className="text-xs text-[var(--color-biz-muted)]">
            {stale === 0
              ? "No document reports INDEXED while holding an unembedded chunk."
              : "Document(s) report INDEXED but hold chunks with no vector — they answer from only part of their text."}
          </p>
        </GlassPanel>

        <GlassPanel className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
            Embedding model
          </p>
          <p className="mt-1.5 text-sm font-medium">{a.embedding.model}</p>
          <p className="text-xs text-[var(--color-biz-muted)]">
            {a.embedding.available
              ? "Credentials present"
              : "No credentials — retrieval is lexical only"}
            {a.embedding.observedDimension
              ? ` · ${a.embedding.observedDimension}d observed`
              : " · dimension not yet observed"}
          </p>
        </GlassPanel>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-[var(--color-biz-muted)]">
          {a.unmeasurable.length} measure(s) this endpoint cannot report, and why
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {a.unmeasurable.map((u) => (
            <li key={u.metric} className="text-xs text-[var(--color-biz-muted)]">
              <span className="font-medium">{u.metric}</span> — {u.missingSource}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

function EvaluationReport({ run }: { run: EvaluationRun }) {
  const pct = (r: { value: number; numerator: number; denominator: number }) =>
    `${Math.round(r.value * 100)}% (${r.numerator}/${r.denominator})`;

  return (
    <div className="mt-4 border-t border-[var(--color-biz-line)] pt-4">
      {run.integrity.degraded ? (
        <p
          role="status"
          className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200"
        >
          {run.integrity.note}
        </p>
      ) : (
        <p className="mb-3 text-xs text-[var(--color-biz-muted)]">{run.integrity.note}</p>
      )}

      <div className="flex flex-wrap gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">
            Expected source retrieved
          </p>
          <p className="text-lg font-semibold tabular-nums">{pct(run.expectedSourceRetrieved)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">
            Top rank correct
          </p>
          <p className="text-lg font-semibold tabular-nums">{pct(run.topRankCorrect)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">
            Permission boundary held
          </p>
          <p className="text-lg font-semibold tabular-nums">{pct(run.permissionBoundary)}</p>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-[var(--color-biz-muted)]">
        These are &ldquo;did the expected source appear&rdquo; rates. They are not precision, recall
        or accuracy — those need a labelled corpus with judged relevance for every document-question
        pair, which this platform does not have.
      </p>

      <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Retrieval evaluation cases table">
        <table className="w-full min-w-[720px] text-xs">
          <caption className="sr-only">Retrieval evaluation cases and outcomes</caption>
          <thead>
            <tr className="text-left uppercase tracking-wide text-[var(--color-biz-muted)]">
              <th scope="col" className="pb-2 font-semibold">Case</th>
              <th scope="col" className="pb-2 font-semibold">Role</th>
              <th scope="col" className="pb-2 font-semibold">Expected</th>
              <th scope="col" className="pb-2 font-semibold">Retrieved</th>
              <th scope="col" className="pb-2 font-semibold">Arms</th>
              <th scope="col" className="pb-2 font-semibold">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {run.results.map((r) => (
              <tr key={r.case.id} className="border-t border-[var(--color-biz-line)] align-top">
                <td className="py-2">
                  <p className="font-medium">{r.case.id}</p>
                  <p className="text-[var(--color-biz-muted)]">{r.case.question}</p>
                </td>
                <td className="py-2">{r.case.role}</td>
                <td className="py-2 text-[var(--color-biz-muted)]">
                  {r.case.expectedDocumentKey ?? "nothing"}
                  {r.case.boundary ? <span className="ml-1 text-amber-300">(boundary)</span> : null}
                </td>
                <td className="py-2 text-[var(--color-biz-muted)]">
                  {r.retrieved.length > 0 ? r.retrieved.join(", ") : "—"}
                </td>
                <td className="py-2 text-[var(--color-biz-muted)]">
                  {r.armsUsed.lexical ? "L" : "-"}
                  {r.armsUsed.semantic ? "S" : "-"}
                </td>
                <td className={cn("py-2 font-medium", r.hit ? "text-emerald-400" : "text-red-300")}>
                  {r.hit ? "as expected" : "missed"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DocumentRow({
  doc,
  expanded,
  onToggle,
  onAct,
}: {
  doc: KnowledgeDocumentRow;
  expanded: boolean;
  onToggle: () => void;
  onAct: <T>(fn: () => Promise<T>, describe: (r: T) => string) => Promise<void>;
}) {
  const detail = useQuery({
    queryKey: ["admin", "knowledge", "document", doc.id],
    queryFn: () => knowledgeApi.getDocument(doc.id),
    enabled: expanded,
  });

  return (
    <>
      <tr className="border-t border-[var(--color-biz-line)] align-top">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="text-left font-medium hover:underline"
          >
            {doc.title}
          </button>
          <p className="text-[11px] text-[var(--color-biz-muted)]">
            {doc.documentKey} · v{doc.version}
          </p>
        </td>
        <td className="px-4 py-3 text-xs">{doc.type.replace(/_/g, " ")}</td>
        <td className="px-4 py-3">
          <Pill label={doc.status} className={STATUS_TONE[doc.status]} />
        </td>
        <td className="px-4 py-3 text-xs">{doc.audience}</td>
        <td className="px-4 py-3">
          <span className={cn("text-xs font-medium", INDEX_TONE[doc.indexState])}>
            {doc.indexState.replace(/_/g, " ")}
          </span>
          <p className="text-[11px] text-[var(--color-biz-muted)]">
            {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"}
            {doc.embeddingDim ? ` · ${doc.embeddingDim}d` : ""}
          </p>
          {doc.indexError && doc.status !== "WITHDRAWN" ? (
            <p className="text-[11px] text-red-300">{doc.indexError}</p>
          ) : null}
        </td>
        <td className="px-4 py-3 text-[11px] text-[var(--color-biz-muted)]">{doc.sourceRef}</td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {doc.status === "DRAFT" ? (
              <ActionButton
                label="Submit for review"
                onClick={() => onAct(() => knowledgeApi.submitForReview(doc.id), (r) => r.detail)}
              />
            ) : null}
            {doc.status === "DRAFT" || doc.status === "IN_REVIEW" ? (
              <ActionButton
                label="Approve"
                onClick={() => onAct(() => knowledgeApi.approve(doc.id), (r) => r.detail)}
              />
            ) : null}
            {doc.status !== "WITHDRAWN" ? (
              <ActionButton
                label="Withdraw"
                onClick={() => {
                  const reason = window.prompt(
                    `Withdraw "${doc.title}" v${doc.version}? It stops being retrievable immediately.\n\nReason (recorded in the audit log):`,
                  );
                  if (reason && reason.trim().length >= 3) {
                    void onAct(() => knowledgeApi.withdraw(doc.id, reason.trim()), (r) => r.detail);
                  }
                }}
              />
            ) : null}
            {doc.indexState !== "INDEXED" && doc.status !== "WITHDRAWN" ? (
              <ActionButton
                label="Re-index"
                onClick={() =>
                  onAct(
                    () => knowledgeApi.reindex(doc.id),
                    (r) => `${r.detail} (${r.embedded}/${r.total} embedded)`,
                  )
                }
              />
            ) : null}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-t border-[var(--color-biz-line)] bg-black/10">
          <td colSpan={7} className="px-4 py-3">
            {detail.isLoading ? (
              <HqLoading label="Loading document text…" />
            ) : detail.isError ? (
              <DataUnavailable
                title="Could not load this document"
                reason={detail.error instanceof Error ? detail.error.message : "The request failed."}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">
                  {detail.data?.chunks.length ?? 0} retrievable chunk(s) — the exact units a citation
                  points at
                </p>
                {(detail.data?.chunks ?? []).map((c) => (
                  <div
                    key={c.id}
                    className="rounded-lg border border-[var(--color-biz-line)] p-3 text-xs"
                  >
                    <p className="mb-1 font-semibold text-[var(--color-biz-muted)]">
                      #{c.chunkIndex}
                      {c.section ? ` · ${c.section}` : ""} · offsets {c.startOffset}–{c.endOffset}
                      {c.embeddingModel ? ` · ${c.embeddingModel}` : " · not embedded"}
                    </p>
                    <p className="whitespace-pre-wrap">{c.content}</p>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        Promise.resolve(onClick()).finally(() => setBusy(false));
      }}
      className="rounded-lg border border-[var(--color-biz-line)] px-2.5 py-1 text-[11px] font-medium hover:bg-white/5 disabled:opacity-50"
    >
      {busy ? "Working…" : label}
    </button>
  );
}

function DeclareAuthorityForm({
  onDone,
}: {
  onDone: (text: string, tone: "ok" | "err") => void;
}) {
  const [type, setType] = useState<KnowledgeType>("TERMS");
  const [rank, setRank] = useState("100");
  const [rationale, setRationale] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      knowledgeApi.declareAuthority({ type, rank: Number(rank), rationale: rationale.trim() }),
    onSuccess: (r) => {
      onDone(r.detail, "ok");
      setRationale("");
    },
    onError: (e: unknown) => onDone(e instanceof Error ? e.message : "Request failed.", "err"),
  });

  return (
    <form
      className="mt-4 border-t border-[var(--color-biz-line)] pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">
        Declare precedence
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-biz-muted)]">Knowledge class</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as KnowledgeType)}
            className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-2.5 py-1.5 text-sm"
          >
            {KNOWLEDGE_TYPES.map((t) => (
              <option key={t} value={t} className="bg-[var(--color-biz-surface)]">
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-biz-muted)]">Rank (higher wins)</span>
          <input
            type="number"
            min={0}
            max={1000}
            value={rank}
            onChange={(e) => setRank(e.target.value)}
            className="w-28 rounded-lg border border-[var(--color-biz-line)] bg-transparent px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-xs">
          <span className="text-[var(--color-biz-muted)]">
            Rationale — required, and recorded permanently
          </span>
          <input
            type="text"
            required
            minLength={10}
            maxLength={1000}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Who decided this, and on what basis"
            className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-2.5 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={mutation.isPending || rationale.trim().length < 10}
          className="rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-medium hover:bg-white/5 disabled:opacity-50"
        >
          {mutation.isPending ? "Declaring…" : "Declare"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-[var(--color-biz-muted)]">
        Precedence decides which of two approved documents the platform answers from. It is a
        governance decision, not a setting: declaring one supersedes the previous declaration rather
        than overwriting it, and every change is audited.
      </p>
    </form>
  );
}

function CreateDocumentForm({
  onDone,
}: {
  onDone: (text: string, tone: "ok" | "err") => void;
}) {
  const [documentKey, setDocumentKey] = useState("");
  const [type, setType] = useState<KnowledgeType>("PARTNER_SOP");
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<KnowledgeAudience>("PARTNER");
  const [sourceRef, setSourceRef] = useState("");
  const [content, setContent] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      knowledgeApi.createDocument({
        documentKey: documentKey.trim(),
        type,
        title: title.trim(),
        audience,
        sourceRef: sourceRef.trim(),
        content,
      }),
    onSuccess: (r) => onDone(`${r.detail} It is a DRAFT until reviewed and approved.`, "ok"),
    onError: (e: unknown) => onDone(e instanceof Error ? e.message : "Request failed.", "err"),
  });

  return (
    <GlassPanel className="mb-3 p-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-biz-muted)]">Document key</span>
            <input
              required
              minLength={3}
              value={documentKey}
              onChange={(e) => setDocumentKey(e.target.value)}
              placeholder="partner.sop.field-conduct"
              className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-biz-muted)]">Title</span>
            <input
              required
              minLength={3}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-2.5 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-biz-muted)]">Class</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as KnowledgeType)}
              className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-2.5 py-1.5 text-sm"
            >
              {KNOWLEDGE_TYPES.map((t) => (
                <option key={t} value={t} className="bg-[var(--color-biz-surface)]">
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-biz-muted)]">Audience — who may ever retrieve it</span>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as KnowledgeAudience)}
              className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-2.5 py-1.5 text-sm"
            >
              {(["PUBLIC", "CUSTOMER", "PARTNER", "INTERNAL"] as const).map((a) => (
                <option key={a} value={a} className="bg-[var(--color-biz-surface)]">
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            <span className="text-[var(--color-biz-muted)]">
              Source of record — where a citation should lead
            </span>
            <input
              required
              minLength={3}
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              placeholder="e.g. Partner Operations Handbook v3, approved by Ops on 2026-04-11"
              className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-2.5 py-1.5 text-sm"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[var(--color-biz-muted)]">
            Content — use ## headings; each becomes a citable section
          </span>
          <textarea
            required
            rows={10}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="rounded-lg border border-[var(--color-biz-line)] bg-transparent px-2.5 py-2 font-mono text-xs"
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-medium hover:bg-white/5 disabled:opacity-50"
          >
            {mutation.isPending ? "Saving…" : "Create draft"}
          </button>
          <p className="text-[11px] text-[var(--color-biz-muted)]">
            Paste only genuine, authorised material. Anything approved here is text the platform will
            state as official policy and cite as its source.
          </p>
        </div>
      </form>
    </GlassPanel>
  );
}
