import type OpenAI from 'openai';
import { classifyQuestion, describePath } from './router';
import { COACH_MODEL, llmClient } from './llm';
import {
  averageSatisfaction,
  averageSpend,
  conversionRate,
  lapsedCustomers,
  providerPerformance,
  rebookingRate,
  retentionRate,
  totalRevenue,
  treatmentPerformance,
} from './metrics';
import type { CustomerRecord, RetrievalPath } from './types';

/**
 * The coaching agent.
 *
 * A tool-use loop rather than one prompt with everything stuffed in: the model asks
 * for the figures it actually needs, which keeps token cost down (the challenge runs
 * on a small credit) and makes the reasoning inspectable. Every number in an answer
 * comes from a tool result computed in code, never from the model's own arithmetic.
 */

export interface KnowledgeHit {
  title: string;
  content: string;
  similarity: number;
}

/** Data the agent can reach. Injected so tests run without a database or network. */
export interface CoachContext {
  records: CustomerRecord[];
  searchKnowledge: (query: string) => Promise<KnowledgeHit[]>;
  /** Overridable for deterministic date maths in tests. */
  now?: Date;
}

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

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_clinic_overview',
      description:
        'Headline clinic metrics: conversion rate, rebooking rate, average spend, total revenue, average satisfaction and 90-day retention. Use for broad questions.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_treatment_performance',
      description:
        'Per-treatment conversion, rebooking, average spend and satisfaction, worst-converting first. Use when asking which treatment or service is underperforming.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_provider_performance',
      description:
        'Per-provider conversion and rebooking, weakest first. Use when asking who needs coaching or attention.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_lapsed_customers',
      description:
        'Customers whose last visit is older than a given number of days. Use for follow-up and retention questions.',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'Days without a visit that counts as lapsed. Default 90.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_clinic_knowledge',
      description:
        "Semantic search over the clinic's uploaded documents (policies, SOPs, pricing, scripts). Use when the answer should come from the clinic's own material.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for in the documents.' },
        },
        required: ['query'],
      },
    },
  },
];

/** Runs one tool and returns a JSON-serialisable result. */
async function runTool(
  name: string,
  input: Record<string, unknown>,
  context: CoachContext,
): Promise<unknown> {
  const { records } = context;
  const now = context.now ?? new Date();

  switch (name) {
    case 'get_clinic_overview':
      return {
        consultations: records.length,
        conversionRate: conversionRate(records),
        rebookingRate: rebookingRate(records),
        averageSpend: averageSpend(records),
        totalRevenue: totalRevenue(records),
        averageSatisfaction: averageSatisfaction(records),
        retentionRate90Day: retentionRate(records, 90, now),
      };

    case 'get_treatment_performance':
      return treatmentPerformance(records);

    case 'get_provider_performance':
      return providerPerformance(records).map((row) => ({
        provider: row.treatment,
        consultations: row.consultations,
        conversionRate: row.conversionRate,
        rebookingRate: row.rebookingRate,
        averageSpend: row.averageSpend,
      }));

    case 'get_lapsed_customers': {
      const days = typeof input.days === 'number' ? input.days : 90;
      const lapsed = lapsedCustomers(records, days, now);
      return {
        days,
        count: lapsed.length,
        // Cap the list; the count matters more than every name.
        customers: lapsed.slice(0, 15).map((r) => ({
          name: r.customerName,
          treatment: r.treatment,
          lastVisit: r.lastVisit,
          spent: r.amountSpent,
        })),
      };
    }

    case 'search_clinic_knowledge': {
      const hits = await context.searchKnowledge(String(input.query ?? ''));
      return hits.length > 0
        ? hits
        : { note: 'No matching content in the uploaded documents.' };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/** Maps a tool name to the source label shown to the user. */
function sourceForTool(name: string): string | null {
  if (name === 'search_clinic_knowledge') return 'uploaded clinic documents';
  if (name.startsWith('get_')) return 'clinic customer data';
  return null;
}

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
