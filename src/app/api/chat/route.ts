import { NextResponse } from 'next/server';
import { z } from 'zod';
import { coach } from '@/lib/agent';
import { loadRecords } from '@/lib/records';
import { searchKnowledge } from '@/lib/knowledge';
import { isSupabaseConfigured } from '@/lib/supabase';
import { isLlmConfigured } from '@/lib/llm';

const RequestSchema = z.object({
  question: z.string().min(1).max(2000),
});

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected a JSON body with a non-empty "question".' },
      { status: 400 },
    );
  }

  if (!isLlmConfigured()) {
    return NextResponse.json(
      { error: 'DEEPSEEK_API_KEY is not configured on the server.' },
      { status: 503 },
    );
  }

  try {
    const records = await loadRecords();

    const result = await coach(parsed.data.question, {
      records,
      // Knowledge search needs both Supabase and an embedding key; degrade to an
      // empty result rather than failing the whole request.
      searchKnowledge: async (query) => {
        if (!isSupabaseConfigured() || !process.env.OPENAI_API_KEY) return [];
        return searchKnowledge(query);
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[chat] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
