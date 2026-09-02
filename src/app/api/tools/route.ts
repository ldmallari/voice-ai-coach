import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { isKnownTool, runTool } from '@/lib/tools';
import { loadRecords } from '@/lib/records';
import { isKnowledgeConfigured, searchKnowledge } from '@/lib/knowledge';

/**
 * Tool endpoint for the n8n orchestrator.
 *
 * n8n owns orchestration, but exact figures must be computed here in code rather
 * than by a language model, so it calls in for them. Protected by a shared secret:
 * these responses contain customer data and must not be openly callable.
 */

const RequestSchema = z.object({
  tool: z.string().min(1),
  input: z.record(z.unknown()).optional(),
});

/** Constant-time comparison so the secret can't be discovered by timing. */
function secretMatches(provided: string | null): boolean {
  const expected = process.env.COACH_TOOL_SECRET;
  if (!expected || !provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!process.env.COACH_TOOL_SECRET) {
    // Failing closed is the only safe default for an endpoint serving customer data.
    return NextResponse.json(
      { error: 'COACH_TOOL_SECRET is not configured; tool endpoint is disabled.' },
      { status: 503 },
    );
  }

  if (!secretMatches(request.headers.get('x-coach-secret'))) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected a JSON body with "tool" and optional "input".' },
      { status: 400 },
    );
  }

  const { tool, input } = parsed.data;
  if (!isKnownTool(tool)) {
    return NextResponse.json({ error: `Unknown tool: ${tool}` }, { status: 400 });
  }

  try {
    const result = await runTool(tool, input ?? {}, {
      records: await loadRecords(),
      searchKnowledge: async (query) =>
        isKnowledgeConfigured() ? searchKnowledge(query) : [],
    });

    return NextResponse.json({ tool, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[tools] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
