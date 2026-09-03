import type OpenAI from 'openai';
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
import type { CustomerRecord } from './types';

/**
 * The tool layer.
 *
 * Defined once and consumed twice: by the in-process agent loop, and by the HTTP
 * endpoint that n8n calls. One definition means the orchestrator and the app can
 * never drift apart on what a tool is or what it returns.
 */

export interface KnowledgeHit {
  title: string;
  content: string;
  similarity: number;
}

/** Data the tools can reach. Injected so tests run without a database or network. */
export interface ToolContext {
  records: CustomerRecord[];
  searchKnowledge: (query: string) => Promise<KnowledgeHit[]>;
  /** Overridable for deterministic date maths in tests. */
  now?: Date;
}

export const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_clinic_report',
      description:
        "The whole clinic data picture in ONE call: headline overview, per-treatment and per-provider performance, and lapsed customers. Prefer this for broad, multi-part, or 'top priorities / where should I focus / what needs attention' questions so you do not need several separate calls. Use the narrower tools only when a single specific metric is enough.",
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'Days without a visit that counts as lapsed, for the lapsed section. Default 90.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_clinic_overview',
      description:
        'Headline clinic metrics only: conversion rate, rebooking rate, average spend, total revenue, average satisfaction and 90-day retention. Use for a single broad metric; for the full picture prefer get_clinic_report.',
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
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<unknown> {
  const { records } = context;
  const now = context.now ?? new Date();

  switch (name) {
    case 'get_clinic_report': {
      // Composes the four data tools by calling them, so every figure is
      // byte-identical to the granular tools — one round-trip, same numbers.
      const days = typeof input.days === 'number' ? input.days : 90;
      return {
        overview: await runTool('get_clinic_overview', {}, context),
        treatments: await runTool('get_treatment_performance', {}, context),
        providers: await runTool('get_provider_performance', {}, context),
        lapsed: await runTool('get_lapsed_customers', { days }, context),
      };
    }

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
export function sourceForTool(name: string): string | null {
  if (name === 'search_clinic_knowledge') return 'uploaded clinic documents';
  if (name.startsWith('get_')) return 'clinic customer data';
  return null;
}


/** Every tool name, for validating requests from the orchestrator. */
export const TOOL_NAMES = TOOLS.map((tool) => tool.function.name);

/** True when `name` is a tool this app actually exposes. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}
