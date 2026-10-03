import { apiRequest } from "@/lib/api-client";

/**
 * Phase-11 knowledge base — the admin panel's only path to the RAG engine.
 *
 * Every call goes to the canonical backend routes. Nothing here ranks, filters by audience, decides
 * precedence or judges whether an answer is grounded: those are backend decisions, and duplicating
 * any of them in the browser would create a second engine whose answers could differ from the real
 * one. The UI renders what the API says, including when what it says is "I will not answer this".
 */

export type KnowledgeType =
  | "FAQ"
  | "CANCELLATION_POLICY"
  | "REFUND_POLICY"
  | "TERMS"
  | "PARTNER_SOP"
  | "SERVICE_INFORMATION"
  | "TRAINING_DOCUMENT";

export const KNOWLEDGE_TYPES: KnowledgeType[] = [
  "FAQ",
  "CANCELLATION_POLICY",
  "REFUND_POLICY",
  "TERMS",
  "PARTNER_SOP",
  "SERVICE_INFORMATION",
  "TRAINING_DOCUMENT",
];

export type KnowledgeStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "SUPERSEDED" | "WITHDRAWN";
export type KnowledgeAudience = "PUBLIC" | "CUSTOMER" | "PARTNER" | "INTERNAL";
export type KnowledgeIndexState =
  | "NOT_INDEXED"
  | "CHUNKED"
  | "EMBEDDED"
  | "INDEXED"
  | "EMBEDDING_FAILED"
  | "INDEX_FAILED";

export type KnowledgeDocumentRow = {
  id: string;
  documentKey: string;
  version: number;
  type: KnowledgeType;
  title: string;
  status: KnowledgeStatus;
  audience: KnowledgeAudience;
  sourceRef: string;
  owner: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  supersededById: string | null;
  withdrawnAt: string | null;
  indexState: KnowledgeIndexState;
  indexError: string | null;
  indexedAt: string | null;
  chunkCount: number;
  embeddingModel: string | null;
  embeddingDim: number | null;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeChunkRow = {
  id: string;
  chunkIndex: number;
  section: string | null;
  content: string;
  startOffset: number;
  endOffset: number;
  tokenEstimate: number;
  embeddingModel: string | null;
  contentHash: string;
};

export type AuthorityRow = {
  type: string;
  rank: number | null;
  version: number | null;
  rationale: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
};

export type AuthorityResolution = {
  state: "POLICY_DEFINED" | "POLICY_UNDEFINED";
  winner: string | null;
  ranking: Array<{ type: string; rank: number | null; rationale: string | null }>;
  undefinedReason?: "NO_RULE_FOR_TYPE" | "RANK_TIE" | "NOT_IN_EFFECT";
  unrankedTypes: string[];
  explanation: string;
};

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentKey: string;
  title: string;
  type: string;
  version: number;
  section: string | null;
  content: string;
  sourceRef: string;
  effectiveFrom: string | null;
  lexicalRank: number | null;
  semanticRank: number | null;
  lexicalScore: number | null;
  semanticScore: number | null;
  fusedScore: number;
};

export type RetrievalResult = {
  state: "RETRIEVED" | "NO_RESULTS" | "NOT_AUTHORIZED" | "DEGRADED";
  chunks: RetrievedChunk[];
  arms: { lexical: boolean; semantic: boolean };
  reasonCode?: string;
  overlap?: { types: string[]; authority: AuthorityResolution | null };
  limitations: string[];
  timings: { lexicalMs: number; semanticMs: number; totalMs: number };
  rulesVersion: string;
};

export type Citation = {
  documentKey: string;
  title: string;
  type: string;
  version: number;
  section: string | null;
  chunkId: string;
  sourceRef: string;
};

export type GroundedAnswer = {
  kind: "KNOWLEDGE" | "REFUSAL" | "REQUIRES_LIVE_DATA" | "REQUIRES_HUMAN_REVIEW";
  answer: string;
  grounded: boolean;
  citations: Citation[];
  retrieval: RetrievalResult;
  refusalReason?: string;
  model: { provider: string | null; model: string | null; latencyMs: number | null };
  limitations: string[];
  generatedAt: string;
  rulesVersion: string;
};

/**
 * Analytics, typed to the shape the endpoint actually returns.
 *
 * `unmeasurable` is part of the contract, not an afterthought. Four measures the audit asks for have
 * no queryable source, and the endpoint names them rather than returning zero — so the console can
 * say "not measurable, and here is why" instead of drawing a chart of nothing.
 */
export type KnowledgeAnalytics = {
  generatedAt: string;
  documents: number;
  approvedDocuments: number;
  chunks: number;
  embeddedChunks: number;
  embeddingCoverage: { value: number | null; numerator: number; denominator: number; reasonCode?: string };
  distributions: {
    type: Record<string, number>;
    status: Record<string, number>;
    audience: Record<string, number>;
    indexState: Record<string, number>;
  };
  embedding: { model: string; available: boolean; observedDimension: number | null };
  indexConsistency: { documentsMarkedIndexedWithUnembeddedChunks: number };
  unmeasurable: Array<{ metric: string; missingSource: string }>;
  state?: "SOURCE_UNAVAILABLE";
  detail?: string;
};

export type EvaluationRun = {
  results: Array<{
    case: {
      id: string;
      question: string;
      expectedDocumentKey: string | null;
      role: string;
      intent: string;
      boundary?: boolean;
    };
    retrieved: string[];
    hit: boolean;
    topKeyMatched: boolean;
    chunkCount: number;
    latencyMs: number;
    armsUsed: { lexical: boolean; semantic: boolean };
  }>;
  expectedSourceRetrieved: { value: number; numerator: number; denominator: number };
  topRankCorrect: { value: number; numerator: number; denominator: number };
  permissionBoundary: { value: number; numerator: number; denominator: number };
  integrity: {
    semanticArmRan: boolean;
    lexicalArmRan: boolean;
    embeddingAvailable: boolean;
    degraded: boolean;
    note: string;
  };
};

type Wrapped<T> = { success: boolean; data?: T };

export const knowledgeApi = {
  listDocuments: (query: { status?: string; type?: string } = {}) =>
    apiRequest<Wrapped<{ documents: KnowledgeDocumentRow[] }>>("/api/admin/knowledge/documents", {
      auth: true,
      query: { ...query },
    }).then((r) => r.data!.documents),

  getDocument: (id: string) =>
    apiRequest<Wrapped<{ document: KnowledgeDocumentRow & { chunks: KnowledgeChunkRow[] } }>>(
      `/api/admin/knowledge/documents/${id}`,
      { auth: true },
    ).then((r) => r.data!.document),

  createDocument: (body: {
    documentKey: string;
    type: KnowledgeType;
    title: string;
    content: string;
    sourceRef: string;
    audience: KnowledgeAudience;
    owner?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
  }) =>
    apiRequest<Wrapped<{ state: string; documentId: string | null; version: number | null; chunkCount: number; unchanged: boolean; detail: string }>>(
      "/api/admin/knowledge/documents",
      { auth: true, method: "POST", body },
    ).then((r) => r.data!),

  submitForReview: (id: string) =>
    apiRequest<Wrapped<{ ok: boolean; detail: string }>>(
      `/api/admin/knowledge/documents/${id}/submit-review`,
      { auth: true, method: "POST" },
    ).then((r) => r.data!),

  approve: (id: string) =>
    apiRequest<Wrapped<{ ok: boolean; detail: string }>>(
      `/api/admin/knowledge/documents/${id}/approve`,
      { auth: true, method: "POST" },
    ).then((r) => r.data!),

  withdraw: (id: string, reason: string) =>
    apiRequest<Wrapped<{ ok: boolean; detail: string }>>(
      `/api/admin/knowledge/documents/${id}/withdraw`,
      { auth: true, method: "POST", body: { reason } },
    ).then((r) => r.data!),

  reindex: (id: string) =>
    apiRequest<Wrapped<{ ok: boolean; embedded: number; total: number; detail: string }>>(
      `/api/admin/knowledge/documents/${id}/reindex`,
      { auth: true, method: "POST" },
    ).then((r) => r.data!),

  seed: () =>
    apiRequest<Wrapped<{ seeded: unknown[]; skipped: Array<{ type: string; reason: string }>; embeddingAvailable: boolean }>>(
      "/api/admin/knowledge/seed",
      { auth: true, method: "POST" },
    ).then((r) => r.data!),

  analytics: () =>
    apiRequest<Wrapped<KnowledgeAnalytics>>("/api/admin/knowledge/analytics", { auth: true }).then(
      (r) => r.data!,
    ),

  /**
   * Run the retrieval evaluation set. Read-only, and deliberately not on page load: it issues one
   * retrieval per case, so it is an action an operator takes rather than a cost every visit pays.
   */
  evaluation: () =>
    apiRequest<Wrapped<EvaluationRun>>("/api/admin/knowledge/evaluation", { auth: true }).then(
      (r) => r.data!,
    ),

  ask: (question: string, topK?: number) =>
    apiRequest<Wrapped<GroundedAnswer>>("/api/admin/knowledge/ask", {
      auth: true,
      method: "POST",
      body: { question, ...(topK ? { topK } : {}) },
    }).then((r) => r.data!),

  retrieve: (question: string, topK?: number) =>
    apiRequest<Wrapped<RetrievalResult>>("/api/admin/knowledge/retrieve", {
      auth: true,
      method: "POST",
      body: { question, ...(topK ? { topK } : {}) },
    }).then((r) => r.data!),

  listAuthority: () =>
    apiRequest<Wrapped<{ active: AuthorityRow[]; history: AuthorityRow[]; empty: boolean }>>(
      "/api/admin/knowledge/authority",
      { auth: true },
    ).then((r) => r.data!),

  declareAuthority: (body: { type: KnowledgeType; rank: number; rationale: string }) =>
    apiRequest<Wrapped<{ ok: boolean; detail: string; version?: number }>>(
      "/api/admin/knowledge/authority",
      { auth: true, method: "POST", body },
    ).then((r) => r.data!),

  revokeAuthority: (type: string, reason: string) =>
    apiRequest<Wrapped<{ ok: boolean; detail: string }>>(
      `/api/admin/knowledge/authority/${type}`,
      { auth: true, method: "DELETE", body: { reason } },
    ).then((r) => r.data!),
};
