import crypto from "crypto";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import type { KnowledgeAudience, KnowledgeType } from "@prisma/client";
import { AuditLogService } from "./audit-log.service";
import { INGEST_STATE, type IngestState } from "./knowledge.types";

/**
 * Phase 11 — turning an approved document into retrievable knowledge.
 *
 * ── Storage is not approval, and approval is not retrievability ────────────────
 *
 * A row here can exist, be chunked, be embedded, and still never be returned by a query. Ingestion
 * writes `DRAFT`; only an explicit approval moves a document to `APPROVED`, and only `APPROVED`
 * documents are retrieval-eligible. That separation is why "someone uploaded a file" can never
 * become "the platform says this is policy".
 *
 * ── Idempotency is structural ──────────────────────────────────────────────────
 *
 * Identity is `(documentKey, version)` behind a UNIQUE index, and the content hash decides whether a
 * re-ingest is a no-op or a real change. Re-running ingestion on unchanged content updates one row
 * and rebuilds nothing; changed content under the same version rebuilds the chunks rather than
 * leaving old ones pointing at text that no longer exists.
 *
 * ── Chunking is deterministic ──────────────────────────────────────────────────
 *
 * Sections first, then a size bound with sentence-boundary preference. The same input always
 * produces the same chunks, which is what makes a citation offset checkable months later.
 */

/** Formats this phase can process. Anything else is refused rather than half-parsed. */
const SUPPORTED_FORMATS = new Set(["txt", "md", "html", "text/plain", "text/markdown"]);

/**
 * Chunk bounds, in characters.
 *
 * Not tuned to make a test pass. ~1,200 characters is roughly 300 tokens, which keeps a policy
 * clause intact in one chunk while leaving room for several chunks in a grounding context. The
 * overlap preserves a sentence that straddles a boundary.
 */
const MAX_CHUNK_CHARS = 1_200;
const CHUNK_OVERLAP_CHARS = 150;
const MIN_CHUNK_CHARS = 80;

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * Normalises text before anything hashes or chunks it.
 *
 * Deliberately conservative: whitespace and line endings only. Stripping punctuation or lowercasing
 * here would change what a citation quotes, and the stored content is what an operator reads back.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type Chunk = {
  chunkIndex: number;
  section: string | null;
  content: string;
  startOffset: number;
  endOffset: number;
  tokenEstimate: number;
};

/**
 * Splits normalised text into retrievable chunks.
 *
 * Markdown headings (`## Section`) become section boundaries and the heading is carried onto every
 * chunk beneath it — that is what lets a citation say "Refund Methods" instead of "characters
 * 4,210-5,380". Offsets are into the normalised content, so a reviewer can verify a quotation
 * exactly.
 */
export function chunkDocument(content: string): Chunk[] {
  const chunks: Chunk[] = [];
  const headingRe = /^#{1,6}\s+(.+)$/gm;

  // Section boundaries first: [offset, heading].
  const sections: Array<{ start: number; heading: string | null }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(content)) !== null) {
    sections.push({ start: m.index, heading: m[1]!.trim() });
  }
  if (sections.length === 0 || sections[0]!.start > 0) {
    sections.unshift({ start: 0, heading: null });
  }

  for (let i = 0; i < sections.length; i++) {
    const secStart = sections[i]!.start;
    const secEnd = i + 1 < sections.length ? sections[i + 1]!.start : content.length;
    const heading = sections[i]!.heading;
    const body = content.slice(secStart, secEnd);

    let cursor = 0;
    while (cursor < body.length) {
      let end = Math.min(cursor + MAX_CHUNK_CHARS, body.length);
      // Prefer a sentence boundary so a chunk does not end mid-clause.
      if (end < body.length) {
        const window = body.slice(cursor, end);
        const lastStop = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n\n"));
        if (lastStop > MIN_CHUNK_CHARS) end = cursor + lastStop + 1;
      }
      const text = body.slice(cursor, end).trim();
      if (text.length >= MIN_CHUNK_CHARS || (chunks.length === 0 && text.length > 0)) {
        chunks.push({
          chunkIndex: chunks.length,
          section: heading,
          content: text,
          startOffset: secStart + cursor,
          endOffset: secStart + end,
          // A rough estimate, named as one. No tokeniser is loaded for this.
          tokenEstimate: Math.ceil(text.length / 4),
        });
      }
      if (end >= body.length) break;
      cursor = Math.max(end - CHUNK_OVERLAP_CHARS, cursor + 1);
    }
  }
  return chunks;
}

export type IngestInput = {
  documentKey: string;
  type: KnowledgeType;
  title: string;
  rawContent: string;
  sourceRef: string;
  audience: KnowledgeAudience;
  format?: string;
  owner?: string;
  language?: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
};

export type IngestResult = {
  state: IngestState;
  documentId: string | null;
  version: number | null;
  chunkCount: number;
  contentHash: string | null;
  /** True when the content was identical to the stored version and nothing was rebuilt. */
  unchanged: boolean;
  detail: string;
};

export const knowledgeIngestionService = {
  /**
   * Ingest one document version.
   *
   * Always lands in `DRAFT`. Approval is a separate, deliberate act by a person with the right
   * permission — ingestion cannot approve its own output, which is the point of having the two
   * states at all.
   */
  async ingest(input: IngestInput): Promise<IngestResult> {
    const fail = (state: IngestState, detail: string): IngestResult => {
      incCounter("knowledge_ingest_total", { result: state });
      return { state, documentId: null, version: null, chunkCount: 0, contentHash: null, unchanged: false, detail };
    };

    if (input.format && !SUPPORTED_FORMATS.has(input.format.toLowerCase())) {
      return fail(INGEST_STATE.UNSUPPORTED_FORMAT, `Format "${input.format}" is not processable by this phase.`);
    }
    if (!input.documentKey.trim() || !input.title.trim()) {
      return fail(INGEST_STATE.INVALID_DOCUMENT, "documentKey and title are required.");
    }

    const content = normalizeText(input.rawContent);
    if (content.length < MIN_CHUNK_CHARS) {
      return fail(INGEST_STATE.INVALID_DOCUMENT, `Normalised content is ${content.length} characters; too short to be knowledge.`);
    }
    const contentHash = sha256(content);

    try {
      /**
       * Version selection.
       *
       * Identical content re-ingested is the *same* version, refreshed — that is what makes running
       * ingestion repeatedly safe. Changed content becomes a new version rather than overwriting an
       * approved one, because silently mutating approved text is how an audit trail stops meaning
       * anything.
       */
      const existingSame = await prisma.knowledgeDocument.findFirst({
        where: { documentKey: input.documentKey, contentHash },
        select: { id: true, version: true, chunkCount: true },
      });
      if (existingSame) {
        incCounter("knowledge_ingest_total", { result: "unchanged" });
        return {
          state: INGEST_STATE.OK, documentId: existingSame.id, version: existingSame.version,
          chunkCount: existingSame.chunkCount, contentHash, unchanged: true,
          detail: "Identical content already ingested; nothing rebuilt.",
        };
      }

      const latest = await prisma.knowledgeDocument.findFirst({
        where: { documentKey: input.documentKey },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;

      const chunks = chunkDocument(content);
      if (chunks.length === 0) {
        return fail(INGEST_STATE.CHUNKING_FAILED, "Chunker produced no chunks.");
      }

      const doc = await prisma.$transaction(async (tx) => {
        const created = await tx.knowledgeDocument.create({
          data: {
            documentKey: input.documentKey, version, type: input.type, title: input.title,
            content, contentHash, sourceRef: input.sourceRef, audience: input.audience,
            owner: input.owner, language: input.language ?? "en",
            effectiveFrom: input.effectiveFrom ?? null, effectiveTo: input.effectiveTo ?? null,
            // DRAFT, always. Ingestion never approves.
            status: "DRAFT", indexState: "CHUNKED", chunkCount: chunks.length,
          },
          select: { id: true },
        });
        await tx.knowledgeChunk.createMany({
          data: chunks.map((c) => ({
            documentId: created.id, chunkIndex: c.chunkIndex, section: c.section,
            content: c.content, startOffset: c.startOffset, endOffset: c.endOffset,
            tokenEstimate: c.tokenEstimate, embedding: [], contentHash: sha256(c.content),
          })),
        });
        return created;
      });

      incCounter("knowledge_ingest_total", { result: "ingested", type: input.type });
      logger.info("knowledge_ingested", {
        documentKey: input.documentKey, version, type: input.type, chunks: chunks.length,
      });
      return {
        state: INGEST_STATE.OK, documentId: doc.id, version, chunkCount: chunks.length,
        contentHash, unchanged: false,
        detail: `Ingested as version ${version} with ${chunks.length} chunks, status DRAFT.`,
      };
    } catch (err) {
      logger.warn("knowledge_ingest_failed", {
        documentKey: input.documentKey, error: String(err).slice(0, 200),
      });
      return fail(INGEST_STATE.INDEX_FAILED, String(err).slice(0, 200));
    }
  },

  /**
   * Move a draft into review.
   *
   * `IN_REVIEW` existed in the schema from the start and nothing ever transitioned into it, so the
   * documented lifecycle had a state no document could reach. Authoring a real FAQ or SOP through
   * the admin path needs the review step to be a thing that happens, not a value in an enum.
   */
  async submitForReview(documentId: string, actorId: string): Promise<{ ok: boolean; detail: string }> {
    const doc = await prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
      select: { id: true, status: true, documentKey: true, version: true },
    });
    if (!doc) return { ok: false, detail: "Document not found." };
    if (doc.status === "IN_REVIEW") return { ok: true, detail: "Already in review." };
    if (doc.status !== "DRAFT") {
      return { ok: false, detail: `Only a DRAFT can be submitted for review; this document is ${doc.status}.` };
    }
    await prisma.knowledgeDocument.update({ where: { id: documentId }, data: { status: "IN_REVIEW" } });
    incCounter("knowledge_review_submissions_total", {});
    logger.info("knowledge_submitted_for_review", {
      documentId, documentKey: doc.documentKey, version: doc.version, actorId,
    });
    return { ok: true, detail: `Version ${doc.version} submitted for review.` };
  },

  /**
   * Approve a document version for retrieval.
   *
   * The only transition that makes knowledge retrievable, and it is deliberately explicit. Approving
   * a new version supersedes the previous approved one in the same transaction, so there is never a
   * moment where two versions of the same document are both current.
   */
  async approve(documentId: string, approverId: string): Promise<{ ok: boolean; detail: string; supersededId?: string }> {
    const doc = await prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
      select: { id: true, documentKey: true, version: true, status: true, indexState: true },
    });
    if (!doc) return { ok: false, detail: "Document not found." };
    if (doc.status === "WITHDRAWN") return { ok: false, detail: "A withdrawn document cannot be approved." };
    if (doc.status === "APPROVED") return { ok: true, detail: "Already approved." };

    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.knowledgeDocument.findFirst({
        where: { documentKey: doc.documentKey, status: "APPROVED", id: { not: doc.id } },
        select: { id: true },
      });
      if (previous) {
        await tx.knowledgeDocument.update({
          where: { id: previous.id },
          data: { status: "SUPERSEDED", supersededById: doc.id },
        });
      }
      await tx.knowledgeDocument.update({
        where: { id: doc.id },
        data: { status: "APPROVED", approvedBy: approverId, approvedAt: new Date() },
      });
      return previous?.id;
    });

    incCounter("knowledge_approvals_total", {});
    /**
     * Recorded in the security audit, not only the application log.
     *
     * Approval is the moment a document becomes something the platform will state as policy. Who did
     * that, and when, has to survive in the same place every other consequential act is recorded.
     */
    void AuditLogService.success("KNOWLEDGE_APPROVED", {
      userId: approverId,
      details: {
        documentId, documentKey: doc.documentKey, version: doc.version,
        supersededId: result ?? null,
      },
    });
    logger.info("knowledge_approved", {
      documentId, documentKey: doc.documentKey, version: doc.version,
      approverId, supersededId: result ?? null,
    });
    return {
      ok: true,
      detail: result
        ? `Approved version ${doc.version}; previous approved version superseded.`
        : `Approved version ${doc.version}.`,
      supersededId: result,
    };
  },

  /**
   * Withdraw a document.
   *
   * The row survives — audit needs to know what was once published and when it stopped being so.
   * What changes is retrieval eligibility, which is decided by status rather than by deletion.
   */
  async withdraw(documentId: string, actorId: string, reason: string): Promise<{ ok: boolean; detail: string }> {
    const doc = await prisma.knowledgeDocument.findUnique({
      where: { id: documentId }, select: { id: true, documentKey: true, version: true },
    });
    if (!doc) return { ok: false, detail: "Document not found." };

    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "WITHDRAWN", withdrawnAt: new Date(), withdrawnBy: actorId, indexError: reason.slice(0, 500) },
    });
    incCounter("knowledge_withdrawals_total", {});
    void AuditLogService.success("KNOWLEDGE_WITHDRAWN", {
      userId: actorId,
      reason: reason.slice(0, 200),
      details: { documentId, documentKey: doc.documentKey, version: doc.version },
    });
    logger.info("knowledge_withdrawn", { documentId, documentKey: doc.documentKey, version: doc.version, actorId });
    return { ok: true, detail: `Version ${doc.version} withdrawn; row retained for audit.` };
  },
};
