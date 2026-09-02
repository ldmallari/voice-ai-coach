import type { RetrievalPath } from './types';

/**
 * Decides which source of truth a question needs before any model call.
 *
 * Doing this deterministically first means the common cases are cheap, testable and
 * explainable, and the agent can state which source it used. Ambiguous questions
 * fall through to 'both' rather than guessing.
 */

/** Signals the answer lives in the customer/consultation data. */
const STRUCTURED_SIGNALS = [
  'conversion', 'converting', 'rebook', 'rebooking', 'retention', 'revenue',
  'spend', 'spent', 'average', 'how many', 'how much', 'rate', 'customers',
  'clients', 'provider', 'declining', 'returned', 'follow-up', 'follow up',
  'satisfaction', 'segment', 'trend', 'last visit', 'lapsed',
];

/** Signals the answer lives in the clinic's own uploaded documents. */
const KNOWLEDGE_SIGNALS = [
  'policy', 'policies', 'sop', 'procedure', 'protocol', 'script', 'standard',
  'aftercare', 'consent', 'pricing sheet', 'price list', 'our guide',
  'documentation', 'what does our', 'according to our', 'per our', 'handbook',
  'training', 'compliance', 'staff should', 'explain this treatment',
];

function countSignals(haystack: string, signals: string[]): number {
  return signals.filter((signal) => haystack.includes(signal)).length;
}

/**
 * Classifies a coach question into a retrieval path.
 * Case-insensitive; returns 'both' when a question spans data and documents,
 * which is the common case for "why is X happening and what should we do".
 */
export function classifyQuestion(question: string): RetrievalPath {
  const text = question.toLowerCase();
  const structured = countSignals(text, STRUCTURED_SIGNALS);
  const knowledge = countSignals(text, KNOWLEDGE_SIGNALS);

  if (structured > 0 && knowledge > 0) return 'both';
  if (structured > 0) return 'structured';
  if (knowledge > 0) return 'knowledge';
  // Nothing matched: a business question with no obvious anchor still deserves
  // both sources rather than a generic answer from the model's own knowledge.
  return 'both';
}

/** Human-readable label for citing the source in an answer. */
export function describePath(path: RetrievalPath): string {
  switch (path) {
    case 'structured':
      return 'clinic customer data';
    case 'knowledge':
      return 'uploaded clinic documents';
    case 'both':
      return 'clinic customer data and uploaded clinic documents';
  }
}
