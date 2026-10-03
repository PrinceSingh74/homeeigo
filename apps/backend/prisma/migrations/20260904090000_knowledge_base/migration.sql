-- Phase 11 — the enterprise knowledge base.
--
-- Additive only: five enums, two tables, one FK. No existing column is altered and no existing row
-- is touched. A generated full-text column plus a GIN index gives lexical retrieval without any
-- extension; semantic retrieval stores plain float arrays because pgvector is neither installed nor
-- bundled in the running postgres:16-alpine image.

CREATE TYPE "KnowledgeType" AS ENUM (
  'FAQ', 'CANCELLATION_POLICY', 'REFUND_POLICY', 'TERMS',
  'PARTNER_SOP', 'SERVICE_INFORMATION', 'TRAINING_DOCUMENT'
);
CREATE TYPE "KnowledgeStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SUPERSEDED', 'WITHDRAWN');
CREATE TYPE "KnowledgeAudience" AS ENUM ('PUBLIC', 'CUSTOMER', 'PARTNER', 'INTERNAL');
CREATE TYPE "KnowledgeIndexState" AS ENUM (
  'NOT_INDEXED', 'CHUNKED', 'EMBEDDED', 'INDEXED', 'EMBEDDING_FAILED', 'INDEX_FAILED'
);

CREATE TABLE "knowledge_documents" (
  "id"              TEXT NOT NULL,
  "document_key"    TEXT NOT NULL,
  "version"         INTEGER NOT NULL DEFAULT 1,
  "type"            "KnowledgeType" NOT NULL,
  "title"           TEXT NOT NULL,
  "content"         TEXT NOT NULL,
  "content_hash"    TEXT NOT NULL,
  "status"          "KnowledgeStatus" NOT NULL DEFAULT 'DRAFT',
  "audience"        "KnowledgeAudience" NOT NULL DEFAULT 'INTERNAL',
  "source_ref"      TEXT NOT NULL,
  "language"        TEXT NOT NULL DEFAULT 'en',
  "owner"           TEXT,
  "effective_from"  TIMESTAMP(3),
  "effective_to"    TIMESTAMP(3),
  "approved_by"     TEXT,
  "approved_at"     TIMESTAMP(3),
  "superseded_by_id" TEXT,
  "withdrawn_at"    TIMESTAMP(3),
  "withdrawn_by"    TEXT,
  "index_state"     "KnowledgeIndexState" NOT NULL DEFAULT 'NOT_INDEXED',
  "index_error"     TEXT,
  "indexed_at"      TIMESTAMP(3),
  "chunk_count"     INTEGER NOT NULL DEFAULT 0,
  "embedding_model" TEXT,
  "embedding_dim"   INTEGER,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_chunks" (
  "id"              TEXT NOT NULL,
  "document_id"     TEXT NOT NULL,
  "chunk_index"     INTEGER NOT NULL,
  "section"         TEXT,
  "content"         TEXT NOT NULL,
  "start_offset"    INTEGER NOT NULL,
  "end_offset"      INTEGER NOT NULL,
  "token_estimate"  INTEGER NOT NULL,
  "embedding"       DOUBLE PRECISION[],
  "embedding_model" TEXT,
  "content_hash"    TEXT NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- One row per (document identity, version). Re-ingesting the same version updates rather than
-- accumulating, which is what makes ingestion idempotent.
CREATE UNIQUE INDEX "knowledge_documents_document_key_version_key"
  ON "knowledge_documents"("document_key", "version");
CREATE INDEX "knowledge_documents_type_status_idx" ON "knowledge_documents"("type", "status");
CREATE INDEX "knowledge_documents_status_audience_idx" ON "knowledge_documents"("status", "audience");
CREATE INDEX "knowledge_documents_content_hash_idx" ON "knowledge_documents"("content_hash");

CREATE UNIQUE INDEX "knowledge_chunks_document_id_chunk_index_key"
  ON "knowledge_chunks"("document_id", "chunk_index");
CREATE INDEX "knowledge_chunks_document_id_idx" ON "knowledge_chunks"("document_id");

ALTER TABLE "knowledge_chunks"
  ADD CONSTRAINT "knowledge_chunks_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lexical retrieval. A generated column keeps the tsvector in lockstep with the content it indexes,
-- so a chunk edit can never leave a stale search vector behind. English config matches the corpus.
ALTER TABLE "knowledge_chunks"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("section", '')), 'A') ||
    setweight(to_tsvector('english', "content"), 'B')
  ) STORED;

CREATE INDEX "knowledge_chunks_search_vector_idx" ON "knowledge_chunks" USING GIN ("search_vector");
