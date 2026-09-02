import type OpenAI from 'openai';
import { z } from 'zod';
import { COACH_MODEL, llmClient } from './llm';
import type { ActionItem, Turn } from './sessions';

/**
 * End-of-session summary and action plan.
 *
 * Asks for structured JSON and validates it, because an action plan the UI has to
 * render cannot be a loose paragraph. If the model returns something unusable, a
 * readable fallback is returned rather than throwing away the whole session.
 */

const ActionSchema = z.object({
  action: z.string().min(1),
  why: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low']),
});

const SummarySchema = z.object({
  summary: z.string().min(1),
  actions: z.array(ActionSchema).max(5),
});

export interface SessionSummary {
  summary: string;
  actions: ActionItem[];
}

const SYSTEM_PROMPT = `You close out coaching sessions for aesthetic clinic owners.

Given the transcript, write a short summary of what was discussed and found, then
up to five concrete next actions. Every action must be something the owner can
actually do, tied to a specific finding from the conversation.

Respond with JSON only, in this shape:
{"summary":"...","actions":[{"action":"...","why":"...","priority":"high|medium|low"}]}

Do not invent figures that were not in the conversation.`;

/** Renders a transcript for the model, dropping source annotations. */
function renderTranscript(turns: Turn[]): string {
  return turns
    .map((turn) => `${turn.role === 'user' ? 'Owner' : 'Coach'}: ${turn.content}`)
    .join('\n\n');
}

export async function summariseSession(
  turns: Turn[],
  client?: OpenAI,
): Promise<SessionSummary> {
  if (turns.length === 0) {
    return { summary: 'No conversation took place in this session.', actions: [] };
  }

  const llm = client ?? llmClient();

  const response = await llm.chat.completions.create({
    model: COACH_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: renderTranscript(turns) },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content ?? '';

  try {
    const parsed = SummarySchema.parse(JSON.parse(raw));
    return parsed;
  } catch {
    // A malformed plan must not lose the session. Return the text we got, flagged.
    console.error('[summary] could not parse structured output');
    return {
      summary:
        raw.trim() ||
        'The session could not be summarised automatically. The transcript is saved.',
      actions: [],
    };
  }
}
