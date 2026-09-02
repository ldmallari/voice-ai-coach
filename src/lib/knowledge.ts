import type { KnowledgeHit } from './agent';

/**
 * Retrieval over the clinic's uploaded documents.
 *
 * Embedding and vector search live in n8n (Hugging Face Inference embeddings into a
 * Supabase Vector Store), because the challenge requires n8n to be the main
 * orchestration layer. This module is the thin client that calls it, so the app
 * never needs an embedding key of its own.
 */

/** Splits document text into overlapping chunks so context isn't cut mid-sentence. */
export function chunkText(text: string, chunkSize = 1000, overlap = 150): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= chunkSize) return clean ? [clean] : [];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    chunks.push(clean.slice(start, end));
    if (end === clean.length) break;
    start = end - overlap;
  }
  return chunks;
}

export function isKnowledgeConfigured(): boolean {
  return Boolean(process.env.N8N_RETRIEVAL_URL);
}

/**
 * Asks n8n for passages relevant to a question.
 * Returns an empty list rather than throwing when retrieval is unavailable, so a
 * data-only question still gets answered.
 */
export async function searchKnowledge(query: string): Promise<KnowledgeHit[]> {
  const url = process.env.N8N_RETRIEVAL_URL;
  if (!url) return [];

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.N8N_WEBHOOK_SECRET
          ? { 'X-Coach-Secret': process.env.N8N_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({ query }),
      // Retrieval must not hold a conversation hostage.
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.error('[knowledge] retrieval failed:', response.status);
      return [];
    }

    const data = (await response.json()) as { matches?: KnowledgeHit[] };
    return data.matches ?? [];
  } catch (error) {
    console.error(
      '[knowledge] retrieval error:',
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}
