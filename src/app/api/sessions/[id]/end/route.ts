import { NextResponse } from 'next/server';
import { sessionStore } from '@/lib/sessions';
import { summariseSession } from '@/lib/summary';
import { isLlmConfigured } from '@/lib/llm';

/**
 * Closes a session: summarises the transcript, stores the summary and action
 * plan, and returns them for display.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!isLlmConfigured()) {
    return NextResponse.json(
      { error: 'DEEPSEEK_API_KEY is not configured on the server.' },
      { status: 503 },
    );
  }

  try {
    const store = sessionStore();
    const transcript = await store.transcript(id);
    const { summary, actions } = await summariseSession(transcript);

    await store.finish(id, summary, actions);

    return NextResponse.json({ sessionId: id, summary, actions });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[sessions] end failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
