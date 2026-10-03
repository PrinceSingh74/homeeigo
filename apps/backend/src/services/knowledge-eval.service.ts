import { knowledgeRetrievalService } from "./knowledge-retrieval.service";
import { embeddingAvailable } from "./knowledge-embedding.service";
import type { KnowledgeActor } from "./knowledge.types";

/**
 * Phase 11 — retrieval evaluation against the real approved corpus.
 *
 * ── What this measures, and what it deliberately does not ──────────────────────
 *
 * Each case names a question and the **document key** that should answer it. The measure is
 * therefore "did the expected source appear in the top-k", which is checkable from the retrieval
 * result itself. That is a real number.
 *
 * It is **not** precision, recall or accuracy. Those need a labelled corpus with judged
 * relevance for every document-query pair, which this platform does not have, and quoting them from
 * a handful of hand-written cases would be inventing a benchmark.
 *
 * ── Every expectation comes from real content ──────────────────────────────────
 *
 * The questions are phrased from HOMEEIGO's own policy text — a customer asking about partner
 * cancellations, a partner asking about SOP. No case asserts a policy answer; each asserts only
 * which approved document should surface, which is a retrieval property rather than a legal claim.
 */

export type EvalCase = {
  id: string;
  question: string;
  /** The `documentKey` expected in the results. Null when the correct answer is "nothing". */
  expectedDocumentKey: string | null;
  role: KnowledgeActor["role"];
  /** Why the case exists, so a failure is diagnosable rather than just red. */
  intent: string;
  /**
   * True when the case measures an access boundary rather than ranking quality.
   *
   * Kept separate in the report because averaging them would let a permission denial inflate a
   * retrieval-quality score — a customer correctly seeing nothing is not evidence that ranking works.
   */
  boundary?: boolean;
};

/**
 * The evaluation set.
 *
 * Deliberately covers the retrieval situations that behave differently, not just the easy one: exact
 * phrasing, paraphrase (where the semantic arm earns its place), a permission boundary, and a
 * question nothing in the corpus answers.
 *
 * ── Cases that depend on content this platform does not have ───────────────────
 *
 * Partner SOP has no corpus here, so a case asserting SOP retrieval would fail for a reason that has
 * nothing to do with retrieval quality. Its cases therefore assert the *permission boundary*, which
 * holds whether or not the content exists: a customer must retrieve nothing from that class. Those
 * cases are marked `boundary`, so a reader can see which numbers measure ranking and which measure
 * access.
 *
 * Internal training is different, and deliberately measured both ways. The operations handbook,
 * incident runbooks and onboarding guide are real documents in `docs/`, so an admin asking an
 * operations question is a genuine *ranking* case, while the same question from a partner or a
 * customer is a *boundary* case. Partner is included on purpose: a partner is a trusted role, and
 * an audience control that only ever excludes customers has not been shown to work.
 */
export const EVAL_CASES: EvalCase[] = [
  {
    id: "exact-partner-cancellation",
    question: "partner cancellations",
    expectedDocumentKey: "legal.cancellation-policy",
    role: "customer",
    intent: "Exact terminology from the policy — the lexical arm should carry this.",
  },
  {
    id: "paraphrase-refund-route",
    question: "how does my money come back to me after a cancelled job",
    expectedDocumentKey: "legal.refund-policy",
    role: "customer",
    intent: "No shared keywords with 'refund methods' — the semantic arm should carry this.",
  },
  {
    id: "terms-jurisdiction",
    question: "which courts govern disputes",
    expectedDocumentKey: "legal.terms",
    role: "customer",
    intent: "Terms content, phrased as a customer would ask it.",
  },
  {
    id: "service-catalogue",
    question: "how long does a typical service take",
    expectedDocumentKey: "catalogue.services",
    role: "customer",
    intent: "Operational catalogue content rather than policy.",
  },
  {
    id: "faq-exact-cancellation",
    question: "How do I reschedule or cancel a booking?",
    expectedDocumentKey: "faq.support",
    role: "customer",
    intent: "The FAQ question verbatim — the corpus the previous pass wrongly reported as missing.",
  },
  {
    id: "faq-paraphrase-wallet",
    question: "what can I use the money stored in my homeeigo account for",
    expectedDocumentKey: "faq.support",
    role: "customer",
    intent: "Paraphrase of the wallet FAQ; no shared keywords with 'wallet work'.",
  },
  {
    id: "faq-membership-customer-only",
    question: "how does membership billing work",
    expectedDocumentKey: "faq.membership",
    role: "customer",
    intent: "CUSTOMER-audience FAQ, retrievable by the audience it belongs to.",
  },
  {
    id: "faq-membership-denied-to-partner",
    question: "how does membership billing work",
    expectedDocumentKey: null,
    role: "partner",
    intent: "The same question from a partner: CUSTOMER-audience content must not surface.",
    boundary: true,
  },
  {
    id: "partner-sop-denied-to-customer",
    question: "partner standard operating procedure for on-site escalation",
    expectedDocumentKey: null,
    role: "customer",
    intent: "PARTNER_SOP is never customer knowledge, whether or not a corpus exists.",
    boundary: true,
  },
  {
    id: "training-denied-to-customer",
    question: "partner academy training module induction",
    expectedDocumentKey: null,
    role: "customer",
    intent: "Internal training material must not reach a customer.",
    boundary: true,
  },
  {
    id: "ops-runbook-to-admin",
    question: "what are the first steps when a P1 alert fires",
    expectedDocumentKey: "ops.incident-runbooks",
    role: "admin",
    intent:
      "Real internal operations content, retrievable by the audience that owns it. This case is " +
      "why TRAINING_DOCUMENT is no longer an empty class.",
  },
  {
    id: "ops-handbook-to-admin",
    question: "what does the morning health check cover",
    expectedDocumentKey: "ops.operations-handbook",
    role: "admin",
    intent: "The operations manual, phrased as an operator would ask it.",
  },
  {
    id: "ops-runbook-denied-to-partner",
    question: "what are the first steps when a P1 alert fires",
    expectedDocumentKey: null,
    role: "partner",
    intent:
      "INTERNAL is internal. A partner is a trusted role and still must not read engineering " +
      "runbooks — the audience boundary is not a customer-only control.",
    boundary: true,
  },
  {
    id: "ops-runbook-denied-to-customer",
    question: "database restore procedure after an outage",
    expectedDocumentKey: null,
    role: "customer",
    intent: "The same INTERNAL content from the least-privileged authenticated role.",
    boundary: true,
  },
  {
    id: "unsupported-topic",
    question: "what is the policy on interplanetary shipping tariffs",
    expectedDocumentKey: null,
    role: "customer",
    intent: "Nothing in the corpus answers this; retrieving something would be the defect.",
  },
];

export type EvalResult = {
  case: EvalCase;
  retrieved: string[];
  /** True when the expected source appeared, or when nothing was expected and nothing came back. */
  hit: boolean;
  topKeyMatched: boolean;
  chunkCount: number;
  latencyMs: number;
  armsUsed: { lexical: boolean; semantic: boolean };
};

export const knowledgeEvalService = {
  /**
   * Run the evaluation set.
   *
   * `topK` is 6, matching the retrieval default, so the numbers describe what the answer path
   * actually sees rather than a widened window chosen to look better.
   */
  async run(actorId: string): Promise<{
    results: EvalResult[];
    expectedSourceRetrieved: { value: number; numerator: number; denominator: number };
    topRankCorrect: { value: number; numerator: number; denominator: number };
    /**
     * Access-boundary cases, scored separately from ranking.
     *
     * A customer correctly seeing nothing is not evidence that ranking works, so folding these into
     * `expectedSourceRetrieved` would let permission denials inflate a retrieval-quality number.
     */
    permissionBoundary: { value: number; numerator: number; denominator: number };
    /**
     * Which retrieval arms actually ran, and whether the run is quotable.
     *
     * ── Why this is part of the result and not a log line ──────────────────────
     *
     * This exact evaluation reported 0.50 and 1.00 on the same corpus twenty minutes apart. The
     * difference was not retrieval quality: the first run had no embedding credentials, the semantic
     * arm never executed, and every paraphrase case failed for a reason that had nothing to do with
     * ranking. The numbers looked like a measurement and were an outage.
     *
     * So the run reports its own validity. `degraded` true means the scores describe a lexical-only
     * system and must not be quoted as this platform's retrieval quality.
     */
    integrity: {
      semanticArmRan: boolean;
      lexicalArmRan: boolean;
      embeddingAvailable: boolean;
      degraded: boolean;
      note: string;
    };
  }> {
    const results: EvalResult[] = [];

    for (const c of EVAL_CASES) {
      const r = await knowledgeRetrievalService.retrieve({
        actor: { actorId, role: c.role }, question: c.question,
      });
      const keys = r.chunks.map((x) => x.documentKey);
      const hit = c.expectedDocumentKey === null
        ? r.chunks.length === 0
        : keys.includes(c.expectedDocumentKey);
      results.push({
        case: c, retrieved: [...new Set(keys)], hit,
        topKeyMatched: c.expectedDocumentKey !== null && keys[0] === c.expectedDocumentKey,
        chunkCount: r.chunks.length, latencyMs: r.timings.totalMs, armsUsed: r.arms,
      });
    }

    const quality = results.filter((r) => !r.case.boundary);
    const boundary = results.filter((r) => r.case.boundary);
    const hits = quality.filter((r) => r.hit).length;
    const ranked = quality.filter((r) => r.case.expectedDocumentKey !== null);
    const topHits = ranked.filter((r) => r.topKeyMatched).length;
    const boundaryHits = boundary.filter((r) => r.hit).length;

    const ratio = (n: number, d: number) => ({
      value: d === 0 ? 0 : Math.round((n / d) * 10000) / 10000,
      numerator: n,
      denominator: d,
    });

    /**
     * The semantic arm is judged over cases that retrieved *something*, and over the run as a whole.
     *
     * A case that correctly returns nothing runs the arm too, so "did any case use it" is the honest
     * question — not "did every case return a semantic hit", which would call a working system
     * degraded whenever the corpus genuinely had no answer.
     */
    const semanticArmRan = results.some((r) => r.armsUsed.semantic);
    const lexicalArmRan = results.some((r) => r.armsUsed.lexical);
    const available = embeddingAvailable();
    const degraded = !available || !semanticArmRan;

    return {
      results,
      expectedSourceRetrieved: ratio(hits, quality.length),
      topRankCorrect: ratio(topHits, ranked.length),
      permissionBoundary: ratio(boundaryHits, boundary.length),
      integrity: {
        semanticArmRan,
        lexicalArmRan,
        embeddingAvailable: available,
        degraded,
        note: degraded
          ? "DEGRADED RUN — the semantic arm did not execute, so these scores describe a lexical-only " +
            "system and must not be quoted as retrieval quality. Check embedding credentials."
          : "Both retrieval arms executed; the scores describe the system as it actually answers.",
      },
    };
  },
};
