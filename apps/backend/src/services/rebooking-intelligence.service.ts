import { recommendForCustomer, type Recommendation } from "./service-recommendation.service";

/**
 * Phase 7, Step 7B — rebooking suggestions.
 *
 * Deliberately not a second scoring engine. `recommendForCustomer` (rules.v3, certified SHADOW as
 * Step 4) already ranks the catalogue for one customer from real repeat count, recency and
 * platform-wide popularity — exactly the inputs a "you might want to rebook" suggestion needs.
 * Duplicating that logic here under a different name would be two engines quietly answering the
 * same question, with no way to know which one a given customer saw.
 *
 * This module's only job is framing: rename the output for the post-service context, and make the
 * one guarantee this capability's approved scope requires explicit — nothing here creates a
 * booking. `Recommendation` from the underlying engine carries no booking-creation method, and
 * this file imports no booking-write path at all, so that guarantee is structural rather than a
 * comment.
 */

export type RebookingSuggestion = Recommendation;

export type RebookingSuggestionsResult = {
  customerId: string;
  suggestions: RebookingSuggestion[];
  /** Same version string `recommendForCustomer` reports — one rules engine, one version number. */
  rulesVersion: string;
  candidateCount: number;
  generatedAt: Date;
};

/**
 * Suggestions only. The caller (a customer-facing route) is responsible for requiring the customer
 * to explicitly initiate any booking that follows — this function has no way to create one.
 */
export async function rebookingSuggestionsFor(
  customerId: string,
  limit = 3,
): Promise<RebookingSuggestionsResult> {
  const { recommendations, rulesVersion, candidateCount } = await recommendForCustomer(customerId, limit);

  return {
    customerId,
    suggestions: recommendations,
    rulesVersion,
    candidateCount,
    generatedAt: new Date(),
  };
}
