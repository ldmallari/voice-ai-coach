import OpenAI from 'openai';
import { serverClient } from './supabase';
import type { KnowledgeHit } from './agent';

/**
 * Retrieval over the clinic's uploaded documents.
 *
 * Embeddings come from OpenAI (1536 dims, matching the pgvector column) and the
 * nearest-neighbour search runs in Postgres via the match_document_chunks RPC.
 */

const EMBEDDING_MODEL = 'text-embedding-3-small';

export async function embed(text: string): Promise<number[]> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' });
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

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

/** Semantic search used as the agent's knowledge tool. */
export async function searchKnowledge(query: string): Promise<KnowledgeHit[]> {
  const embedding = await embed(query);
  const { data, error } = await serverClient().rpc('match_document_chunks', {
    query_embedding: embedding,
    match_count: 5,
    min_similarity: 0.2,
  });

  if (error) throw new Error(`Knowledge search failed: ${error.message}`);

  return (data ?? []) as KnowledgeHit[];
}
