import { NextResponse } from 'next/server';
import { z } from 'zod';
import { coach } from '@/lib/agent';
import { loadRecords } from '@/lib/records';
import { isKnowledgeConfigured, searchKnowledge } from '@/lib/knowledge';
import { isLlmConfigured } from '@/lib/llm';
import { askN8nCoach, isN8nCoachConfigured } from '@/lib/orchestrator';
import { sessionStore } from '@/lib/sessions';

const RequestSchema = z.object({
  question: z.string().min(1).max(2000),
  /** Optional: when present, both turns are appended to the session record. */
  sessionId: z.string().min(1).optional(),
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

    const { question, sessionId } = parsed.data;
    const store = sessionId ? sessionStore() : null;

    if (store && sessionId) {
      await store.append(sessionId, { role: 'user', content: question, sources: [] });
    }

    // n8n is the main orchestration layer when configured; the in-process agent
    // is the fallback if it is unreachable, so a demo never dies on a cold n8n.
    const runInProcess = () =>
      coach(question, {
        records,
        // Knowledge search needs both Supabase and an embedding key; degrade to
        // an empty result rather than failing the whole request.
        searchKnowledge: async (query) => {
          if (!isKnowledgeConfigured()) return [];
          return searchKnowledge(query);
        },
      });

    let result;
    if (isN8nCoachConfigured()) {
      try {
        result = await askN8nCoach(question, sessionId);
      } catch (error) {
        console.warn(
          '[chat] n8n orchestrator failed; falling back in-process:',
          error instanceof Error ? error.message : error,
        );
        result = await runInProcess();
      }
    } else {
      result = await runInProcess();
    }

    if (store && sessionId) {
      await store.append(sessionId, {
        role: 'assistant',
        content: result.answer,
        sources: result.sources,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[chat] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
