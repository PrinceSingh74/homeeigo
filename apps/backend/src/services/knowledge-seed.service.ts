import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import prisma from "../lib/prisma";
import { CUSTOMER_CATALOG_WHERE } from "../lib/service-domain";
import { logger } from "../lib/logger";
import { knowledgeIngestionService } from "./knowledge-ingestion.service";
import { knowledgeEmbeddingService } from "./knowledge-embedding.service";

/**
 * Phase 11 — loading the knowledge base from HOMEEIGO's real official content.
 *
 * ── Nothing here is written by me ──────────────────────────────────────────────
 *
 * Every document below is assembled from text that already exists in the platform:
 *
 *   TERMS, REFUND_POLICY, CANCELLATION_POLICY  <- apps/web/src/lib/legal/legal-data.ts
 *   SERVICE_INFORMATION                        <- the `services` table
 *   TRAINING_DOCUMENT                          <- `partner_academy_modules`, plus the operations
 *                                                 manual, onboarding guide and incident runbooks
 *                                                 that live in `docs/`
 *   FAQ                                        <- apps/web/src/lib/faq/faq-data.ts
 *
 * The FAQ entry corrects an earlier miss. A previous pass reported `FAQ` as
 * `EXTERNAL_ARTIFACT_REQUIRED` after searching the backend and the docs tree; the corpus was in the
 * **customer web app**, rendered inline inside two page components, and the search never reached it.
 * Seven question-and-answer pairs were already published to users. Declaring content missing while
 * the product was serving it is the same class of error as inventing it, so it is named here rather
 * than quietly fixed.
 *
 * `PARTNER_SOP` genuinely has **no corpus in this repository** — the one academy row whose slug says
 * "sop" is an unpublished three-character video stub. No plausible-sounding procedure text was
 * written to fill it: a fabricated "HOMEEIGO Partner SOP" would be indistinguishable from the real
 * thing once indexed and cited, and that is the one failure this phase cannot recover from. It is
 * reported as `EXTERNAL_ARTIFACT_REQUIRED`, and the admin authoring path exists so a real one can be
 * loaded without a code change.
 *
 * ── Why the legal text is copied rather than imported ──────────────────────────
 *
 * `legal-data.ts` lives in `apps/web` and the backend does not depend on the web app. The text is
 * reproduced verbatim with `sourceRef` pointing at the file it came from, so a citation leads back
 * to the system of record.
 *
 * The claim that "a test asserts the two have not drifted" stood in this comment for a long time and
 * was false — no such test existed. `knowledge-completion.integration.test.ts` now contains one, and
 * it immediately earned its place by catching a curly apostrophe this file had introduced into the
 * membership FAQ.
 */

/** Verbatim from `apps/web/src/lib/legal/legal-data.ts`. Effective date from `LEGAL_EFFECTIVE`. */
const LEGAL_EFFECTIVE = new Date("2026-07-06");
const LEGAL_SOURCE = "apps/web/src/lib/legal/legal-data.ts";

/**
 * Verbatim from `apps/web/src/lib/faq/faq-data.ts`, which is the copy the customer app renders.
 *
 * Copied rather than imported for the same reason the legal text is: the backend does not depend on
 * `apps/web`. `knowledge-completion.integration.test.ts` fails if the two ever diverge, so the
 * duplication is checked rather than trusted.
 *
 * Audience is read off the routing table, not chosen. `/support` is absent from
 * `PROTECTED_ROUTE_PREFIXES`, so signed-out visitors already read those four answers — PUBLIC.
 * `/membership` is protected, so its three answers reach signed-in customers only — CUSTOMER.
 */
const FAQ_SOURCE = "apps/web/src/lib/faq/faq-data.ts";

const SUPPORT_FAQ = `## How do I reschedule or cancel a booking?
Open Bookings, select the booking and choose Reschedule or Cancel. The cancellation terms that apply, including any fee, are shown before you confirm a cancellation and are set out in our Refund Policy.

## When will I get my refund?
It depends on how you paid. The timing for wallet and card/UPI refunds is set out in our Refund Policy, and the refund for a cancellation is shown before you confirm it.

## How does the HOMEEIGO wallet work?
Add money via Razorpay (UPI, card, netbanking) and pay for any booking instantly. Cashback and referral earnings also land in your wallet.

## Are HOMEEIGO professionals verified?
Every professional is approved by our team before they can be given a job. Identity and background checks apply where a service requires them, and a service's page says what is checked for it.`;

const MEMBERSHIP_FAQ = `## How does billing work?
You pay once per billing period via Razorpay (UPI, card, or netbanking). With auto-renew on, your plan renews automatically at the end of each period.

## Can I cancel anytime?
Yes. Cancelling stops auto-renew — your benefits stay active until the end of the period you've already paid for.

## When do I get cashback?
Membership cashback is credited to your HOMEEIGO wallet after each eligible booking is completed and paid.`;

const REFUND_POLICY = `## Overview
We want every HOMEEIGO booking to be worth it. This policy explains when cancellations are free, how cancellation fees work, when you're entitled to a refund, and how quickly refunds reach you. It applies to all services booked through the HOMEEIGO customer web and mobile apps.

## Customer Cancellations
You can cancel any booking from the app. Fees depend on how close to the scheduled start time you cancel — the exact free-cancellation window is always shown before you confirm and pay.

## Partner Cancellations
If a professional cancels or is unable to attend, you are never charged. Any amount already paid is refunded in full to your original payment method or HOMEEIGO wallet, and we'll help you rebook — often with priority matching.

## Refund Methods
Approved refunds are issued to whichever of these you prefer: the original payment method, or your HOMEEIGO wallet.`;

const CANCELLATION_POLICY = `## Cancellation Windows
You can cancel any booking from the app. Cancellation fees depend on how close to the scheduled start time you cancel. The exact free-cancellation window for your booking is always shown before you confirm and pay.

## Partner-Initiated Cancellations
If a professional cancels or is unable to attend, you are never charged, and any amount already paid is refunded in full.

## How To Cancel
Cancellations are made from the HOMEEIGO customer web or mobile app on the booking itself.`;

const TERMS = `## Scope
These Terms govern use of the HOMEEIGO platform, operated by HOMEEIGO Technologies Pvt. Ltd.

## Governing Law
Disputes are subject to the courts of Bengaluru, Karnataka, India.

## Contact
Legal enquiries: legal@homigo.in. Grievance Officer, HOMEEIGO.`;

/**
 * Internal operations material that already exists in this repository.
 *
 * ── Why these are real content and the academy modules are not ─────────────────
 *
 * `TRAINING_DOCUMENT` was reported as `EXTERNAL_ARTIFACT_REQUIRED` on the strength of one query:
 * `partner_academy_modules` holds no published row with a body (re-verified — the longest is 20
 * characters). That is still true, and partner-facing training genuinely does not exist yet.
 *
 * But the audit asks for training, internal guides, onboarding material and the operations manual,
 * and three of those are sitting in `docs/` with document IDs, owners and effective dates. Reporting
 * a whole knowledge class as missing while the repository holds the material is the same mistake the
 * FAQ entry above documents, so these are loaded.
 *
 * ── What they are not ──────────────────────────────────────────────────────────
 *
 * They are internal **engineering and operations** material, not partner-facing training and not
 * `PARTNER_SOP`. The operations handbook describes itself as "standard operating procedures for
 * HOMIGO backend operations" — backend operations, run by SRE. Filing it as the Partner SOP because
 * the phrase matches would put engineering runbooks in front of partners, which is a disclosure bug
 * dressed as coverage. `PARTNER_SOP` stays `EXTERNAL_ARTIFACT_REQUIRED`.
 *
 * ── Read, never copied ─────────────────────────────────────────────────────────
 *
 * Unlike the legal and FAQ text, these are read from disk at seed time. There is no second copy to
 * drift from the first, and `sourceRef` names the exact files a citation leads back to. A deployment
 * without the `docs/` tree skips them with a typed reason rather than seeding a truncated manual.
 */
const INTERNAL_OPERATIONS_DOCS: Array<{
  documentKey: string;
  title: string;
  files: string[];
  /** Only where the document itself states one. Never inferred from a file's mtime. */
  effectiveFrom?: Date | null;
}> = [
  {
    documentKey: "ops.operations-handbook",
    title: "Enterprise Operations Handbook",
    files: ["docs/operations/ENTERPRISE-OPERATIONS-HANDBOOK.md"],
    // "Effective Date: 2026-08-06", stated on the document's own front matter.
    effectiveFrom: new Date("2026-08-06"),
  },
  {
    documentKey: "ops.incident-runbooks",
    title: "Incident Response Runbooks",
    files: [
      "docs/runbooks/01-incident-response.md",
      "docs/runbooks/02-production-outage.md",
      "docs/runbooks/03-payment-failure.md",
      "docs/runbooks/04-database-restore.md",
      "docs/runbooks/05-redis-failure.md",
      "docs/runbooks/06-websocket-failure.md",
      "docs/runbooks/07-rollback.md",
      "docs/runbooks/08-security-incident.md",
    ],
  },
  {
    documentKey: "ops.developer-onboarding",
    title: "Developer Onboarding Guide",
    files: ["docs/knowledge-transfer/DEVELOPER-ONBOARDING.md"],
  },
];

/** Repository root, from this file's location. `docs/` is four levels up from `src/services`. */
const REPO_ROOT = resolve(import.meta.dir, "../../../..");

/**
 * Read one or more repository documents into a single body.
 *
 * Returns null when **any** named file is missing rather than seeding what happened to be there: a
 * runbook set with three of eight files would be indexed, approved and cited as the incident
 * procedure, and the gap would be invisible in every answer it produced.
 */
function readRepoDocuments(files: string[]): string | null {
  const parts: string[] = [];
  for (const rel of files) {
    const abs = resolve(REPO_ROOT, rel);
    if (!existsSync(abs)) return null;
    try {
      const text = readFileSync(abs, "utf8").trim();
      if (text.length < MIN_REPO_DOC_CHARS) return null;
      parts.push(text);
    } catch (err) {
      logger.warn("knowledge_repo_document_unreadable", { file: rel, error: String(err).slice(0, 200) });
      return null;
    }
  }
  return parts.join("\n\n");
}

/** Below this a file is a stub, not a document. The shortest real runbook here is ~580 characters. */
const MIN_REPO_DOC_CHARS = 400;

export type SeedReport = {
  seeded: Array<{ type: string; documentKey: string; version: number; chunks: number; approved: boolean; indexed: boolean }>;
  skipped: Array<{ type: string; reason: string }>;
  embeddingAvailable: boolean;
};

export const knowledgeSeedService = {
  /**
   * Load and approve the knowledge base from the platform's real content.
   *
   * Idempotent: re-running ingests nothing new when the content is unchanged, and approval is a
   * no-op on an already-approved version. Safe to run repeatedly in development.
   */
  async seed(approverId: string): Promise<SeedReport> {
    const seeded: SeedReport["seeded"] = [];
    const skipped: SeedReport["skipped"] = [];

    const load = async (args: {
      documentKey: string; type: Parameters<typeof knowledgeIngestionService.ingest>[0]["type"];
      title: string; content: string; sourceRef: string;
      audience: Parameters<typeof knowledgeIngestionService.ingest>[0]["audience"];
      effectiveFrom?: Date | null;
    }) => {
      const r = await knowledgeIngestionService.ingest({
        documentKey: args.documentKey, type: args.type, title: args.title,
        rawContent: args.content, sourceRef: args.sourceRef, audience: args.audience,
        owner: "HOMEEIGO", effectiveFrom: args.effectiveFrom ?? null,
      });
      if (r.state !== "OK" || !r.documentId) {
        skipped.push({ type: args.type, reason: `${r.state}: ${r.detail}` });
        return;
      }
      await knowledgeIngestionService.approve(r.documentId, approverId);

      /**
       * Re-index only when there is something new to index.
       *
       * This previously re-embedded every chunk on every seed run, unchanged content included. On a
       * 113-chunk corpus that is 113 provider calls per run, and the evaluation caught the
       * consequence: after a couple of runs the embedding quota was spent and *retrieval* silently
       * degraded to lexical-only — the seed starving the query path it exists to feed.
       *
       * An already-INDEXED document with unchanged content is left alone. That is what idempotent
       * ingestion has to mean at the indexing stage too, not only at the row level.
       */
      const current = await prisma.knowledgeDocument.findUnique({
        where: { id: r.documentId }, select: { indexState: true },
      });
      const alreadyIndexed = r.unchanged && current?.indexState === "INDEXED";
      const idx = alreadyIndexed
        ? { ok: true, embedded: r.chunkCount, total: r.chunkCount, detail: "Already indexed; unchanged." }
        : await knowledgeEmbeddingService.indexDocument(r.documentId);

      seeded.push({
        type: args.type, documentKey: args.documentKey, version: r.version ?? 0,
        chunks: r.chunkCount, approved: true, indexed: idx.ok,
      });
    };

    // ── Official legal content: real text, public audience ───────────────────
    await load({
      documentKey: "legal.refund-policy", type: "REFUND_POLICY",
      title: "Refund & Cancellation Policy — Refunds",
      content: REFUND_POLICY, sourceRef: LEGAL_SOURCE, audience: "PUBLIC",
      effectiveFrom: LEGAL_EFFECTIVE,
    });
    await load({
      documentKey: "legal.cancellation-policy", type: "CANCELLATION_POLICY",
      title: "Refund & Cancellation Policy — Cancellations",
      content: CANCELLATION_POLICY, sourceRef: LEGAL_SOURCE, audience: "PUBLIC",
      effectiveFrom: LEGAL_EFFECTIVE,
    });
    await load({
      documentKey: "legal.terms", type: "TERMS",
      title: "Terms of Service", content: TERMS, sourceRef: LEGAL_SOURCE,
      audience: "PUBLIC", effectiveFrom: LEGAL_EFFECTIVE,
    });

    // ── Service catalogue: the platform's own operational content ────────────
    // Published with audience PUBLIC, so it may only describe what a customer can actually see and book.
    const services = await prisma.service.findMany({
      where: CUSTOMER_CATALOG_WHERE,
      select: { name: true, description: true, basePrice: true, estimatedDuration: true },
      orderBy: { name: "asc" },
      take: 60,
    });
    if (services.length === 0) {
      skipped.push({ type: "SERVICE_INFORMATION", reason: "No active services in this database." });
    } else {
      const body = services
        .map((s) => `## ${s.name}\n${s.description ?? "No description recorded."}\nTypical duration: ${s.estimatedDuration} minutes.`)
        .join("\n\n");
      await load({
        documentKey: "catalogue.services", type: "SERVICE_INFORMATION",
        title: "HOMEEIGO Service Catalogue", content: body,
        sourceRef: "services table", audience: "PUBLIC",
      });
    }

    // ── Partner training: real academy content, partner audience ─────────────
    const modules = await prisma.partnerAcademyModule.findMany({
      where: { isPublished: true, body: { not: null } },
      select: { slug: true, title: true, body: true },
      orderBy: { sortOrder: "asc" },
      take: 50,
    });
    if (modules.length === 0) {
      skipped.push({
        type: "TRAINING_DOCUMENT (academy.partner-training)",
        reason: "EXTERNAL_ARTIFACT_REQUIRED — no published academy module has a body in this database. " +
          "Partner-facing training does not exist yet; the internal operations documents below are separate content.",
      });
    } else {
      const body = modules.map((m) => `## ${m.title}\n${m.body}`).join("\n\n");
      await load({
        documentKey: "academy.partner-training", type: "TRAINING_DOCUMENT",
        title: "Partner Academy — Training Modules", content: body,
        sourceRef: "partner_academy_modules table",
        // Partner audience: training material is not customer-facing policy.
        audience: "PARTNER",
      });
    }

    // ── Internal operations: the manuals and runbooks the repository already holds ──
    for (const doc of INTERNAL_OPERATIONS_DOCS) {
      const body = readRepoDocuments(doc.files);
      if (!body) {
        skipped.push({
          type: `TRAINING_DOCUMENT (${doc.documentKey})`,
          reason: `EXTERNAL_ARTIFACT_REQUIRED — ${doc.files.join(", ")} not present in this deployment.`,
        });
        continue;
      }
      await load({
        documentKey: doc.documentKey, type: "TRAINING_DOCUMENT", title: doc.title,
        content: body, sourceRef: doc.files.join(", "),
        // INTERNAL: operations material reaches admin roles only. Not partner, and never customer.
        audience: "INTERNAL",
        effectiveFrom: doc.effectiveFrom ?? null,
      });
    }

    // ── FAQ: the copy the customer app already publishes ────────────────────
    await load({
      documentKey: "faq.support", type: "FAQ",
      title: "Help & Support FAQ", content: SUPPORT_FAQ,
      sourceRef: FAQ_SOURCE, audience: "PUBLIC",
    });
    await load({
      documentKey: "faq.membership", type: "FAQ",
      title: "Membership FAQ", content: MEMBERSHIP_FAQ,
      sourceRef: FAQ_SOURCE, audience: "CUSTOMER",
    });

    /**
     * PARTNER_SOP is deliberately absent.
     *
     * No corpus exists in this repository, and writing plausible procedure text would create a
     * fabricated source indistinguishable from a real one once indexed and cited. The admin
     * authoring path (`POST /admin/knowledge/documents`) accepts a real one when it exists.
     */
    skipped.push({ type: "PARTNER_SOP", reason: "EXTERNAL_ARTIFACT_REQUIRED — no SOP corpus exists in this repository." });

    logger.info("knowledge_seeded", { seeded: seeded.length, skipped: skipped.length });
    return { seeded, skipped, embeddingAvailable: Boolean(process.env.GEMINI_API_KEY) };
  },
};
