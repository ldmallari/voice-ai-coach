import type OpenAI from 'openai';
import { classifyQuestion, describePath } from './router';
import { COACH_MODEL, llmClient } from './llm';
import { TOOLS, runTool, sourceForTool, type ToolContext } from './tools';
import type { RetrievalPath } from './types';

export type { KnowledgeHit, ToolContext } from './tools';

/**
 * The coaching agent.
 *
 * A tool-use loop rather than one prompt with everything stuffed in: the model asks
 * for the figures it actually needs, which keeps token cost down (the challenge runs
 * on a small credit) and makes the reasoning inspectable. Every number in an answer
 * comes from a tool result computed in code, never from the model's own arithmetic.
 */

/** Data the agent can reach. Alias of the shared tool context. */
export type CoachContext = ToolContext;

export interface CoachAnswer {
  answer: string;
  /** Which sources actually contributed, for citation in the UI. */
  sources: string[];
  path: RetrievalPath;
  toolCalls: string[];
}

const SYSTEM_PROMPT = `You are a business coach for the owner of an aesthetic clinic.

You have two sources of truth:
1. Clinic customer data - consultation records, treatments, providers, spend, rebooking.
2. The clinic's own uploaded documents - policies, SOPs, pricing, consultation scripts.

Rules:
- Use tools to get real figures. Never estimate or invent a number.
- Say which source an answer came from, and what you found in it.
- Give specific coaching tied to this clinic's numbers, not generic business advice.
- When the data shows a likely cause, say so and name the next action.
- If the data cannot answer something, say that plainly instead of guessing.
- Keep answers short enough to be spoken aloud.

Weak answer: "There are many possible reasons your sales might be declining."
Better: "Your consultation volume is healthy, but CoolSculpting conversion is well
below your other treatments. Look at what happens during those consultations."`;

/** Parses tool arguments defensively; a malformed blob must not kill the turn. */
function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Answers one coaching question.
 * `maxTurns` bounds the tool loop so a confused model cannot spin indefinitely.
 */
export async function coach(
  question: string,
  context: CoachContext,
  client?: OpenAI,
  maxTurns = 5,
): Promise<CoachAnswer> {
  const llm = client ?? llmClient();
  const path = classifyQuestion(question);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${question}\n\n(Routing hint: this likely needs ${describePath(path)}.)`,
    },
  ];

  const toolCalls: string[] = [];
  const sources = new Set<string>();

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await llm.chat.completions.create({
      model: COACH_MODEL,
      messages,
      tools: TOOLS,
    });

    const message = response.choices[0]?.message;
    const requested = message?.tool_calls ?? [];

    if (requested.length === 0) {
      return {
        answer: (message?.content ?? '').trim(),
        sources: [...sources],
        path,
        toolCalls,
      };
    }

    messages.push(message!);

    for (const call of requested) {
      const name = call.function.name;
      toolCalls.push(name);

      const source = sourceForTool(name);
      if (source) sources.add(source);

      const result = await runTool(
        name,
        parseArguments(call.function.arguments),
        context,
      );
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Loop exhausted: say so rather than returning a half-formed answer.
  return {
    answer:
      'I could not settle on an answer within the allowed number of steps. Please narrow the question.',
    sources: [...sources],
    path,
    toolCalls,
  };
}
