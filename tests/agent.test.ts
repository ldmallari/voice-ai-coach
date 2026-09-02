import { describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import { coach, type CoachContext } from '@/lib/agent';
import { generateCustomers } from '@/lib/synthetic';

/**
 * The DeepSeek API is mocked throughout. CI must never spend the challenge credit,
 * and the behaviour under test is our orchestration, not the model's wording.
 */

function fakeClient(responses: unknown[]): OpenAI {
  const create = vi.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

/** Shorthand for the mock's recorded calls. */
function callsOf(client: OpenAI) {
  return (client.chat.completions.create as unknown as ReturnType<typeof vi.fn>).mock
    .calls;
}

function textResponse(content: string) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

function toolResponse(name: string, args: Record<string, unknown> = {}) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call_${name}`,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

function context(overrides: Partial<CoachContext> = {}): CoachContext {
  return {
    records: generateCustomers(),
    searchKnowledge: async () => [],
    now: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

/** Reads the tool result handed back to the model on a given call index. */
function toolPayload(client: OpenAI, callIndex: number) {
  const messages = callsOf(client)[callIndex][0].messages;
  return JSON.parse(messages.at(-1).content);
}

describe('coach', () => {
  it('returns the model answer when no tools are needed', async () => {
    const client = fakeClient([textResponse('Conversion looks healthy.')]);
    const result = await coach('How is the business doing?', context(), client);

    expect(result.answer).toBe('Conversion looks healthy.');
    expect(result.toolCalls).toEqual([]);
  });

  it('runs a requested tool and feeds the result back to the model', async () => {
    const client = fakeClient([
      toolResponse('get_treatment_performance'),
      textResponse('CoolSculpting is your weakest converter.'),
    ]);

    const result = await coach('Which treatment needs attention?', context(), client);

    expect(result.toolCalls).toEqual(['get_treatment_performance']);
    expect(result.answer).toContain('CoolSculpting');
    expect(callsOf(client)).toHaveLength(2);
  });

  it('computes tool figures in code, not in the model', async () => {
    const client = fakeClient([
      toolResponse('get_clinic_overview'),
      textResponse('done'),
    ]);

    await coach('Give me an overview', context(), client);
    const payload = toolPayload(client, 1);

    expect(payload.consultations).toBe(60);
    expect(payload.conversionRate).toBeGreaterThan(0);
    expect(payload.conversionRate).toBeLessThanOrEqual(1);
  });

  it('honours tool arguments sent by the model', async () => {
    const client = fakeClient([
      toolResponse('get_lapsed_customers', { days: 30 }),
      textResponse('done'),
    ]);

    await coach('Who has not been in for a month?', context(), client);
    expect(toolPayload(client, 1).days).toBe(30);
  });

  it('cites the customer data source when a data tool ran', async () => {
    const client = fakeClient([
      toolResponse('get_provider_performance'),
      textResponse('Nurse Kahu converts lowest.'),
    ]);

    const result = await coach('Who needs coaching?', context(), client);
    expect(result.sources).toContain('clinic customer data');
  });

  it('cites the document source when knowledge search ran', async () => {
    const searchKnowledge = vi.fn(async () => [
      { title: 'Consultation SOP', content: 'Always confirm pricing.', similarity: 0.8 },
    ]);
    const client = fakeClient([
      toolResponse('search_clinic_knowledge', { query: 'consultation script' }),
      textResponse('Your SOP says to confirm pricing.'),
    ]);

    const result = await coach(
      'What does our SOP recommend?',
      context({ searchKnowledge }),
      client,
    );

    expect(searchKnowledge).toHaveBeenCalledWith('consultation script');
    expect(result.sources).toContain('uploaded clinic documents');
  });

  it('tells the model when no documents match instead of returning silence', async () => {
    const client = fakeClient([
      toolResponse('search_clinic_knowledge', { query: 'refund policy' }),
      textResponse('Nothing in your documents covers refunds.'),
    ]);

    await coach('What is our refund policy?', context(), client);
    expect(toolPayload(client, 1).note).toMatch(/No matching content/i);
  });

  it('survives malformed tool arguments rather than throwing', async () => {
    // Failure case: the model emits invalid JSON for its arguments.
    const client = fakeClient([
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_bad',
                  type: 'function',
                  function: { name: 'get_lapsed_customers', arguments: '{days: 30' },
                },
              ],
            },
          },
        ],
      },
      textResponse('recovered'),
    ]);

    const result = await coach('Who lapsed?', context(), client);

    // Falls back to the documented default rather than crashing.
    expect(toolPayload(client, 1).days).toBe(90);
    expect(result.answer).toBe('recovered');
  });

  it('stops and says so when the model loops without answering', async () => {
    const client = fakeClient([
      toolResponse('get_clinic_overview'),
      toolResponse('get_clinic_overview'),
      toolResponse('get_clinic_overview'),
    ]);

    const result = await coach('Why is revenue down?', context(), client, 3);

    expect(result.answer).toMatch(/could not settle on an answer/i);
    expect(result.toolCalls).toHaveLength(3);
    expect(callsOf(client)).toHaveLength(3);
  });

  it('surfaces an unknown tool as an error rather than crashing the turn', async () => {
    const client = fakeClient([
      toolResponse('get_something_that_does_not_exist'),
      textResponse('recovered'),
    ]);

    const result = await coach('Anything', context(), client);

    expect(toolPayload(client, 1).error).toMatch(/Unknown tool/);
    expect(result.answer).toBe('recovered');
  });
});
