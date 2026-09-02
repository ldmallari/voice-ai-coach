import Anthropic from '@anthropic-ai/sdk';
import { classifyQuestion, describePath } from './router';
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
 * Deliberately a tool-use loop rather than one prompt with everything stuffed in:
 * the model asks for the figures it actually needs, which keeps token cost down and
 * makes the reasoning inspectable. Every number in an answer comes from a tool
 * result computed in code, never from the model's own arithmetic.
 */

export const COACH_MODEL = 'claude-sonnet-5';

/** Data the agent can reach. Injected so tests can run without a database. */
export interface CoachContext {
  records: CustomerRecord[];
  /** Returns relevant clinic-document passages for a question. */
  searchKnowledge: (query: string) => Promise<KnowledgeHit[]>;
  /** Overridable for deterministic date maths in tests. */
  now?: Date;
}

export interface KnowledgeHit {
  title: string;
  content: string;
  similarity: number;
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

Weak answer: "There are many possible reasons your sales might be declining."
Better: "Your consultation volume is healthy, but CoolSculpting conversion is well
below your other treatments. Look at what happens during those consultations."`;

/** Tool schemas exposed to the model. */
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_clinic_overview',
    description:
      'Headline clinic metrics: conversion rate, rebooking rate, average spend, total revenue, average satisfaction and retention. Use this first for broad questions.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_treatment_performance',
    description:
      'Per-treatment conversion, rebooking, average spend and satisfaction, worst-converting first. Use when asking which treatment or service is underperforming.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_provider_performance',
    description:
      'Per-provider conversion and rebooking, weakest first. Use when asking who needs coaching or attention.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_lapsed_customers',
    description:
      'Customers whose last visit is older than a given number of days. Use for follow-up and retention questions.',
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'How many days without a visit counts as lapsed. Default 90.',
        },
      },
    },
  },
  {
    name: 'search_clinic_knowledge',
    description:
      "Semantic search over the clinic's uploaded documents (policies, SOPs, pricing, scripts). Use when the answer should come from the clinic's own material.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for in the documents.' },
      },
      required: ['query'],
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
      const query = String(input.query ?? '');
      const hits = await context.searchKnowledge(query);
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

/**
 * Answers one coaching question.
 * `maxTurns` bounds the tool loop so a confused model cannot spin indefinitely.
 */
export async function coach(
  question: string,
  context: CoachContext,
  client?: Anthropic,
  maxTurns = 5,
): Promise<CoachAnswer> {
  const anthropic =
    client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });

  const path = classifyQuestion(question);
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `${question}\n\n(Routing hint: this question likely needs ${describePath(path)}.)`,
    },
  ];

  const toolCalls: string[] = [];
  const sources = new Set<string>();

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await anthropic.messages.create({
      model: COACH_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      return { answer: text, sources: [...sources], path, toolCalls };
    }

    messages.push({ role: 'assistant', content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      toolCalls.push(use.name);
      const source = sourceForTool(use.name);
      if (source) sources.add(source);

      const result = await runTool(
        use.name,
        (use.input ?? {}) as Record<string, unknown>,
        context,
      );
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: 'user', content: results });
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
