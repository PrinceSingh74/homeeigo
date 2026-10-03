-- Phase 11 — administratively-declared knowledge precedence.
--
-- The table is created empty on purpose. No HOMEEIGO document, contract or config declares that one
-- knowledge type outranks another, so the engine models precedence rather than assuming it. Until an
-- authorised administrator declares ranks, a conflict between two policy types resolves to
-- HUMAN_REVIEW_REQUIRED instead of to whichever source a ranking function happened to prefer.

CREATE TYPE "KnowledgeAuthorityStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REVOKED');

CREATE TABLE "knowledge_authority_rules" (
    "id" TEXT NOT NULL,
    "type" "KnowledgeType" NOT NULL,
    "rank" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "KnowledgeAuthorityStatus" NOT NULL DEFAULT 'ACTIVE',
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_by_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revoked_reason" TEXT,

    CONSTRAINT "knowledge_authority_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "knowledge_authority_rules_type_version_key"
    ON "knowledge_authority_rules"("type", "version");
CREATE INDEX "knowledge_authority_rules_type_status_idx"
    ON "knowledge_authority_rules"("type", "status");

-- At most one ACTIVE declaration per knowledge type, enforced by the database rather than by the
-- service that writes it. Two active ranks for the same type would make resolution non-deterministic,
-- and "the code always supersedes first" is a claim a partial index can simply guarantee.
CREATE UNIQUE INDEX "knowledge_authority_rules_one_active_per_type"
    ON "knowledge_authority_rules"("type") WHERE "status" = 'ACTIVE';
